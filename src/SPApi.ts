import {
  HttpClientImproved,
  HttpClientOptions,
  Request
} from "../../hyperttp/src";

import { CLIENT_VERSION, HOME_PAGE_URL } from "./constants";
import { Totp } from "./Totp";
import { LRUCache } from "lru-cache";

/**
 * =========================
 * HTTP CONFIG
 * =========================
 */
const DEFAULT_HTTP_CONFIG: HttpClientOptions = {
  timeout: 15_000,
  maxRetries: 2,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  enableCache: false,
  verbose: true,
  allowHttp2: false,
  logger: (level, message, meta) => {
    console.log(`[HTTP ${level.toUpperCase()}] ${message}`, meta || "");
  }
};

type SessionInfo = {
  accessToken: string;
  clientId: string;
  accessTokenExpirationTimestampMs: number;
};

export class SPApi {
  private user = {
    token: "",
    clientToken: "",
    expiresAt: 0
  };

  private totp: Totp | null = null;
  private spDc: string;
  private http: HttpClientImproved;

  private initPromise: Promise<void> | null = null;
  private inflight = new Map<string, Promise<any>>();

  /**
   * =========================
   * CACHE
   * =========================
   */
  private cache = {
    track: new LRUCache<string, any>({ max: 500, ttl: 300_000 }),
    playback: new LRUCache<string, any>({ max: 300, ttl: 120_000 }),
    audio: new LRUCache<string, any>({ max: 1000, ttl: 600_000 }),
    search: new LRUCache<string, any>({ max: 200, ttl: 60_000 })
  };

  /**
   * storage-resolve cache (🔥 important)
   */
  private resolveCache = new LRUCache<string, string>({
    max: 5000,
    ttl: 1000 * 60 * 60
  });

  private readonly QUALITY_MAP: Record<string, string> = {
    flac: "HiFi",
    "320": "320kbps",
    "160": "160kbps"
  };

  private readonly PLAYBACK_QUERY =
    "manifestFileFormat=file_ids_mp4&manifestFileFormat=file_ids_mp4flac";

  constructor(
    spDc?: string,
    httpClient = new HttpClientImproved(DEFAULT_HTTP_CONFIG)
  ) {
    this.spDc = spDc || "";
    this.http = httpClient;
  }

  /**
   * =========================
   * INIT
   * =========================
   */
  async initialize() {
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
      this.user.clientToken = clientToken.granted_token.token;
    })();

    return this.initPromise;
  }

  /**
   * =========================
   * DEDUPE
   * =========================
   */
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

  /**
   * =========================
   * SERVER TIME
   * =========================
   */
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

  /**
   * =========================
   * SESSION
   * =========================
   */
  private async getSessionToken(totpCode: string): Promise<SessionInfo> {
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

  /**
   * =========================
   * CLIENT TOKEN
   * =========================
   */
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
          Origin: HOME_PAGE_URL,
          Referer: HOME_PAGE_URL,
          "User-Agent": DEFAULT_HTTP_CONFIG.userAgent!,
          "Spotify-App-Version": CLIENT_VERSION
        },
        bodyData: JSON.stringify(payload)
      });

      const res = await this.http.post<any>(req, "json");

      if (!res?.granted_token?.token) {
        throw new Error(`Client token failed: ${JSON.stringify(res)}`);
      }

      return res;
    });
  }

  /**
   * =========================
   * PLAYBACK
   * =========================
   */
  async getPlaybackInfo(trackId: string) {
    await this.initialize();

    const cached = this.cache.playback.get(trackId);
    if (cached) return cached;

    return this.dedupe(`playback:${trackId}`, async () => {
      const req = new Request({
        scheme: "https",
        host: "spclient.wg.spotify.com",
        port: 443,
        path: `/track-playback/v1/media/spotify:track:${trackId}?${this.PLAYBACK_QUERY}`,
        headers: {
          Authorization: `Bearer ${this.user.token}`,
          "Client-Token": this.user.clientToken,
          "App-Platform": "WebPlayer",
          "Spotify-App-Version": CLIENT_VERSION,
          Cookie: `sp_dc=${this.spDc}`
        }
      });

    const res = await this.http.get<any>(req, "json");
    if (res?.error_code === 8) throw new Error("INVALID_USER");

    this.cache.playback.set(trackId, res);
    return res;
  });
  }

  /**
   * =========================
   * AUDIO URLs
   * =========================
   */
  async getAudioUrls(trackId: string) {
    await this.initialize();

    const cached = this.cache.audio.get(trackId);
    if (cached) return cached;

    return this.dedupe(`audio:${trackId}`, async () => {
      const playback = await this.getPlaybackInfo(trackId);

      const mediaKey = Object.keys(playback.media)[0];
      const item = playback.media[mediaKey]?.item;
      const files = item?.manifest?.file_ids_mp4flac || item?.manifest?.file_ids_mp4 || [];

      // Параллельно резолвим все файлы
      const urlPromises = files.map(async (file: any) => {
        const url = await this.resolveAudioFile(file.format, file.file_id);
        if (!url) return null;

        return {
          quality: this.getQualityLabel(file.format),
          fileId: file.file_id,
          format: file.format,
          url
        };
      });

      const urls = (await Promise.all(urlPromises)).filter(Boolean);

      const result = { trackId, urls };
      this.cache.audio.set(trackId, result);

      return result;
    });
  }

  /**
   * =========================
   * FAST RESOLVE (🔥 OPTIMIZED)
   * =========================
   */
  private async resolveAudioFile(formatId: string, fileId: string): Promise<string | null> {
    const cacheKey = `${formatId}:${fileId}`;
    if (this.resolveCache.has(cacheKey)) {
      return this.resolveCache.get(cacheKey)!;
    }

    const hosts = ["spclient.wg.spotify.com"]; // можно добавить 1-2 fallback, если хочешь

    for (const host of hosts) {
      try {
        const req = new Request({
          scheme: "https",
          host,
          port: 443,
          path: `/storage-resolve/v2/files/audio/interactive/${formatId}/${fileId}`,
          query: { version: "10000000", product: "9", platform: "39", alt: "json" },
          headers: {
            authorization: `Bearer ${this.user.token}`,
            "client-token": this.user.clientToken,
          },
        });

        const res = await this.http.get<any>(req, "json");
        const url = res?.cdnurl?.[0] || res?.url;

        if (url) {
          this.resolveCache.set(cacheKey, url);
          return url;
        }
      } catch (err) {
        console.warn(`[resolve] ${host} failed for ${formatId}`, err?.message);
      }
    }
    return null;
  }

  /**
   * =========================
   * QUALITY
   * =========================
   */
  private getQualityLabel(formatId: string): string {
    const f = String(formatId).toLowerCase();

    if (f === "11") return "HiFi (FLAC)";
    if (f === "10") return "320kbps";

    if (f.includes("flac")) return "HiFi";
    if (f.includes("320")) return "320kbps";
    if (f.includes("160")) return "160kbps";

    return `unknown(${formatId})`;
  }
}

export default SPApi;