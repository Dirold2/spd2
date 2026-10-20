import { HyperClient } from "hyperttp";
import type { SpotifyPlaybackResponse, SpotifyPlaylistTrack, TrackMeta, TrackAudio } from "../core/index.js";
export declare class SPApi {
    private http;
    private auth;
    private playback;
    private searchCache;
    private playlistCache;
    private albumCache;
    private resolveCashe;
    private inflight;
    constructor(spDc?: string, httpClient?: HyperClient);
    initialize(): Promise<void>;
    getPlaybackInfo(trackId: string): Promise<SpotifyPlaybackResponse>;
    getAudioUrls(trackId: string): Promise<TrackAudio>;
    getTrack(trackId: string): Promise<TrackMeta>;
    getAudio(trackId: string, options?: {
        quality?: "OGG_VORBIS_96" | "OGG_VORBIS_160" | "OGG_VORBIS_320" | "MP4_128" | "MP4_256" | "FLAC_FLAC" | "MP4_FLAC" | "FLAC_FLAC_24" | "MP4_FLAC_24";
    }): Promise<TrackAudio>;
    getPlaylistTracks(playlistId: string, options?: {
        maxTracks?: number;
    }): Promise<SpotifyPlaylistTrack[]>;
    getAlbumTracks(albumId: string, options?: {
        maxTracks?: number;
    }): Promise<SpotifyPlaylistTrack[]>;
    search(query: string, limit?: number): Promise<any>;
    getHeaders(): Record<string, string>;
    getCdnHeaders(): Record<string, string>;
    private dedupe;
    private resolveAudioFile;
    private static readonly FORMAT_LABELS;
    private getQualityLabel;
    private normalizePlayback;
}
export default SPApi;
//# sourceMappingURL=SPApi.d.ts.map