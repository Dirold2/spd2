import { HyperClient } from "hyperttp";
import type { SpotifyUser } from "./types.js";
export declare class AuthManager {
    private user;
    private totp;
    private spDc;
    private http;
    private initPromise;
    private inflight;
    constructor(spDc: string, http: HyperClient);
    initialize(): Promise<void>;
    getUser(): SpotifyUser;
    isExpired(): boolean;
    refreshIfNeeded(): Promise<void>;
    getHeaders(): Record<string, string>;
    getCdnHeaders(): Record<string, string>;
    private dedupe;
    private getServerTime;
    private getSessionToken;
    private getClientToken;
}
//# sourceMappingURL=auth.d.ts.map