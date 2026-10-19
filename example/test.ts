import "dotenv/config";
import { HyperClient } from "hyperttp";
import { CLIENT_VERSION, HOME_PAGE_URL } from "../src/core/constants.js";
import { Totp } from "../src/core/totp.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const httpClient = new HyperClient({
  crypto: { digest: false },
  retry: { maxRetries: 2 },
  verbose: true
});

async function getServerTime(): Promise<number> {
  const response = await httpClient.get<{ serverTime?: number }>(
    "https://open.spotify.com/api/server-time",
    { responseType: "json", timeout: 15_000 }
  );

  return response.serverTime ? response.serverTime * 1000 : Date.now();
}

async function getSessionToken(totpCode: string, totpVer: string) {
  const response = await httpClient.get<{
    accessToken?: string;
    access_token?: string;
    clientId?: string;
    client_id?: string;
  }>("https://open.spotify.com/api/token", {
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
      "user-agent": USER_AGENT,
      "spotify-app-version": CLIENT_VERSION,
      "app-platform": "WebPlayer"
    },
    responseType: "json",
    timeout: 15_000
  });

  const accessToken = response.accessToken ?? response.access_token;
  const clientId = response.clientId ?? response.client_id;

  if (!accessToken || !clientId) {
    throw new Error(`getSessionToken failed: ${JSON.stringify(response, null, 2)}`);
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

  const response = await httpClient.post<{
    granted_token?: { token?: string };
  }>(
    "https://clienttoken.spotify.com/v1/clienttoken",
    payload,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: HOME_PAGE_URL,
        Referer: HOME_PAGE_URL,
        "User-Agent": USER_AGENT,
        "Spotify-App-Version": CLIENT_VERSION,
        "App-Platform": "WebPlayer"
      },
      responseType: "json",
      timeout: 15_000
    }
  );

  if (!response?.granted_token?.token) {
    throw new Error(`Client token failed: ${JSON.stringify(response)}`);
  }

  console.log("client token acquired");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
