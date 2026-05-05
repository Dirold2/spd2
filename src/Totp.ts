// totp.ts
import { createHmac } from "node:crypto";
import { HttpClientImproved, Request } from "../../hyperttp/src";
import { TOTP_DIGITS, TOTP_PERIOD, TOTP_SECRETS_URL } from "./constants";

export class Totp {
  constructor(
    public readonly version: string,
    private readonly secret: Buffer
  ) {}

  static async initialize(httpClient: HttpClientImproved): Promise<Totp> {
    const secrets = await httpClient.get<Record<string, number[]>>(
      "https://git.gay/thereallo/totp-secrets/raw/branch/main/secrets/secretDict.json",
      "json"
    );

    if (!secrets || typeof secrets !== "object") {
      throw new Error("Failed to load TOTP secrets");
    }

    const versions = Object.keys(secrets).sort((a, b) => Number(a) - Number(b));

    const version = versions[versions.length - 1];

    if (!version) {
      throw new Error("No TOTP version found");
    }

    return new Totp(version, Totp.derive(secrets[version]));
  }

  static derive(ciphertext: ArrayLike<number>): Buffer {
    const bytes = Array.from(ciphertext, (byte, i) =>
      String(byte ^ ((i % 33) + 9))
    ).join("");
    return Buffer.from(bytes, "ascii");
  }

  generate(timestamp: number): string {
    const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD);

    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(BigInt(counter));

    const hmacResult = createHmac("sha1", this.secret)
      .update(counterBytes)
      .digest();

    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const binary =
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff);

    return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  }
}
