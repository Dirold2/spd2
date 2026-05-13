import "dotenv/config";
import { HttpClientImproved, HttpClientOptions, Request } from "hyperttp";
import { CLIENT_VERSION, HOME_PAGE_URL } from "../src/core/constants";
import { Totp } from "../src/core/totp";

const DEFAULT_HTTP_CONFIG: HttpClientOptions = {
  network: {
    timeout: 15000,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    allowHttp2: false
  },
  retry: {
    maxRetries: 2
  },
  cache: {
    enabled: false
  },
  verbose: true,
};

const httpClient = new HttpClientImproved(DEFAULT_HTTP_CONFIG);

async function getServerTime(): Promise<number> {
  const request = new Request({
    scheme: "https",
    host: "open.spotify.com",
    port: 443,
    path: "/api/server-time"
  });

  const response = await httpClient.get<any>(request, "json");
  return response?.serverTime ? response.serverTime * 1000 : Date.now();
}

async function getSessionToken(totpCode: string, totpVer: string) {
  const request = new Request({
    scheme: "https",
    host: "open.spotify.com",
    port: 443,
    path: "/api/token",
    query: {
      reason: "init",
      productType: "web-player",
      totp: totpCode,
      totpServer: totpCode,
      totpVer
    },
    headers: {
      accept: "application/json",
      "accept-language": "en-US",
      "content-type": "application/json",
      origin: HOME_PAGE_URL,
      referer: HOME_PAGE_URL,
      "user-agent": DEFAULT_HTTP_CONFIG.network?.userAgent!,
      "spotify-app-version": CLIENT_VERSION,
      "app-platform": "WebPlayer"
    }
  });

  const response = await httpClient.get<any>(request, "json");

  const accessToken = response?.accessToken ?? response?.access_token;
  const clientId = response?.clientId ?? response?.client_id;

  if (!accessToken || !clientId) {
    throw new Error(
      `getSessionToken failed: ${JSON.stringify(response, null, 2)}`
    );
  }

  return { accessToken, clientId };
}

async function main() {
  console.log("Loading TOTP...");
  const totp = await Totp.initialize(httpClient);
  console.log("TOTP version:", totp.version);

  console.log("Fetching server time...");
  const serverTime = await getServerTime();
  console.log("serverTime:", serverTime);

  const totpCode = totp.generate(serverTime);
  console.log("totpCode:", totpCode);

  console.log("Getting session token...");
  const sessionInfo = await getSessionToken(totpCode, totp.version);
  console.log("sessionInfo.clientId:", sessionInfo.clientId);

  const payload = {
    client_data: {
      client_version: CLIENT_VERSION,
      client_id: sessionInfo.clientId,
      js_sdk_data: {}
    }
  };

  console.log("clienttoken payload:", JSON.stringify(payload, null, 2));

  const resp = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: HOME_PAGE_URL,
      Referer: HOME_PAGE_URL,
      "User-Agent": DEFAULT_HTTP_CONFIG.network?.userAgent!,
      "Spotify-App-Version": CLIENT_VERSION,
      "App-Platform": "WebPlayer"
    },
    body: JSON.stringify(payload)
  });

  console.log("status:", resp.status);
  console.log(await resp.text());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
