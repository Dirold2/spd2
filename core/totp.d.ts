import { HyperClient } from "hyperttp";
export declare class Totp {
    readonly version: string;
    private readonly secret;
    constructor(version: string, secret: Buffer);
    static initialize(httpClient: HyperClient): Promise<Totp>;
    static derive(ciphertext: ArrayLike<number>): Buffer;
    generate(timestamp: number): string;
}
//# sourceMappingURL=totp.d.ts.map