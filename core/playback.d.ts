import { HyperClient } from "hyperttp";
import { AuthManager } from "./auth.js";
import type { SpotifyPlaybackResponse, TrackAudio } from "./types.js";
export declare class PlaybackManager {
    private http;
    private auth;
    private cache;
    private resolveCache;
    private inflight;
    constructor(http: HyperClient, auth: AuthManager);
    getPlaybackInfo(trackId: string): Promise<SpotifyPlaybackResponse>;
    getAudioUrls(trackId: string): Promise<TrackAudio>;
    private resolveAudioFile;
    private static readonly FORMAT_LABELS;
    private getQualityLabel;
    private dedupe;
}
//# sourceMappingURL=playback.d.ts.map