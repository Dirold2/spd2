import { HttpClientImproved, Request } from "hyperttp";
import { Totp } from "./totp.js";
import { CLIENT_VERSION, HOME_PAGE_URL } from "./constants.js";
import { SpotifyUser, ClientTokenResponse } from "./types.js";

export class AuthManager {
  private user: SpotifyUser = { token: "", clientToken: "", expiresAt: 0 };
  private totp: Totp | null = null;
  private spDc: string;
  private http: HttpClientImproved;
  private initPromise: Promise<void> | null = null;
  private inflight = new Map<string, Promise<any>>();

  constructor(spDc: string, http: HttpClientImproved) {
    this.spDc = spDc;
    this.http = http;
  }

  async initialize(): Promise<void> {
    if (this.user.token && this.user.clientToken) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.totp ??= await Totp.initialize(this.http);

      const serverTime = await this.getServerTime();
      const totpCode = this.totp.generate(serverTime);

      const session = await this.getSessionToken(totpCode);
      this.user.token = session.accessToken;
      this.user.expiresAt = session.accessTokenExpirationTimestampMs;

      const clientToken = await this.getClientToken(session.clientId);
      this.user.clientToken = clientToken.granted_token!.token;
    })();

    return this.initPromise;
  }

  getUser(): SpotifyUser {
    return { ...this.user };
  }

  isExpired(): boolean {
    return Date.now() >= this.user.expiresAt;
  }

  async refreshIfNeeded(): Promise<void> {
    if (this.isExpired() || !this.user.token) {
      this.user = { token: "", clientToken: "", expiresAt: 0 };
      this.initPromise = null;
      await this.initialize();
    }
  }

  getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.user.token}`,
      "Client-Token": this.user.clientToken,
      Cookie: `sp_dc=${this.spDc}`
    };
  }

  getCdnHeaders(): Record<string, string> {
    return {
      Referer: HOME_PAGE_URL,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    };
  }

  private async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  private async getServerTime(): Promise<number> {
    return this.dedupe("server-time", async () => {
      const req = new Request({
        scheme: "https",
        host: "open.spotify.com",
        port: 443,
        path: "/api/server-time"
      });

      const res = await this.http.get<any>(req, "json");
      return res.serverTime ? res.serverTime * 1000 : Date.now();
    });
  }

  private async getSessionToken(totpCode: string) {
    return this.dedupe(`session-${totpCode}`, async () => {
      const req = new Request({
        scheme: "https",
        host: "open.spotify.com",
        port: 443,
        path: "/api/token",
        query: {
          reason: "init",
          productType: "web-player",
          totp: totpCode,
          totpServer: totpCode,
          totpVer: this.totp?.version ?? ""
        },
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: HOME_PAGE_URL,
          referer: HOME_PAGE_URL,
          Cookie: `sp_dc=${this.spDc}`,
          "spotify-app-version": CLIENT_VERSION,
          "app-platform": "WebPlayer"
        }
      });

      const res = await this.http.get<any>(req, "json");

      return {
        accessToken: res.accessToken ?? res.access_token,
        clientId: res.clientId ?? res.client_id,
        accessTokenExpirationTimestampMs:
          res.accessTokenExpirationTimestampMs ??
          Date.now() + (res.expiresIn || 3600) * 1000
      };
    });
  }

  private async getClientToken(clientId: string) {
    return this.dedupe(`client-token-${clientId}`, async () => {
      const payload = {
        client_data: {
          client_version: CLIENT_VERSION,
          client_id: clientId,
          js_sdk_data: {
            device_model: "unknown",
            os: "Windows",
            os_version: "10"
          }
        }
      };

      const req = new Request({
        scheme: "https",
        host: "clienttoken.spotify.com",
        port: 443,
        path: "/v1/clienttoken",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: HOME_PAGE_URL,
          Referer: HOME_PAGE_URL,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          "Spotify-App-Version": CLIENT_VERSION,
          "App-Platform": "WebPlayer"
        },
        bodyData: JSON.stringify(payload)
      });

      const res = await this.http.post<ClientTokenResponse>(req, "json");

      if (!res?.granted_token?.token) {
        throw new Error(`Client token failed: ${JSON.stringify(res)}`);
      }

      return res;
    });
  }
}
