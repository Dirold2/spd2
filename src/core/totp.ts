import { createHmac } from "node:crypto";
import { HyperClient } from "hyperttp";
import { TOTP_DIGITS, TOTP_PERIOD } from "./constants.js";

export class Totp {
  constructor(
    public readonly version: string,
    private readonly secret: Buffer
  ) {}

  static async initialize(httpClient: HyperClient): Promise<Totp> {
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

    const ciphertext = secrets[version];
    if (!ciphertext) {
      throw new Error(`No TOTP secret for version ${version}`);
    }

    return new Totp(version, Totp.derive(ciphertext));
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

    const offset = hmacResult.readUInt8(hmacResult.length - 1) & 0x0f;
    const binary = hmacResult.readUInt32BE(offset) & 0x7fffffff;

    return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  }
}
