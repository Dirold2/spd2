import { HttpClientImproved, HttpClientOptions, Request } from "hyperttp";
import { LRUCache } from "lru-cache";
import {
  AuthManager,
  PlaybackManager,
  TrackMeta,
  TrackAudio,
  normalizeTrackId
} from "../core/index.js";

const DEFAULT_HTTP_CONFIG: HttpClientOptions = {
  timeout: 15_000,
  maxRetries: 2,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  enableCache: false,
  verbose: true,
  allowHttp2: false,
  maxResponseBytes: 100 * 1024 * 1024,
  logger: (level, message, meta) => {
    console.log(`[HTTP ${level.toUpperCase()}] ${message}`, meta || "");
  }
};

export class SPApi {
  private http: HttpClientImproved;
  private auth: AuthManager;
  private playback: PlaybackManager;

  private searchCache = new LRUCache<string, any>({ max: 200, ttl: 60_000 });
  private resolveCashe = new LRUCache<string, any>({ max: 200, ttl: 60_000 });
  private inflight = new Map<string, Promise<any>>();

  constructor(spDc?: string, httpClient?: HttpClientImproved) {
    this.http = httpClient || new HttpClientImproved(DEFAULT_HTTP_CONFIG);
    this.auth = new AuthManager(spDc || "", this.http);
    this.playback = new PlaybackManager(this.http, this.auth);
  }

  async initialize(): Promise<void> {
    return this.auth.initialize();
  }

  async getPlaybackInfo(trackId: string) {
    return this.playback.getPlaybackInfo(trackId);
  }

  async getAudioUrls(trackId: string) {
    return this.playback.getAudioUrls(trackId);
  }

  async getTrack(trackId: string): Promise<TrackMeta> {
    const id = normalizeTrackId(trackId);
    return this.dedupe(`meta:${id}`, async () => {
      const playback = await this.playback.getPlaybackInfo(id);
      return this.normalizePlayback(playback, id);
    });
  }

  async getAudio(
    trackId: string,
    options: {
      quality?:
        | "OGG_VORBIS_96"
        | "OGG_VORBIS_160"
        | "OGG_VORBIS_320"
        | "MP4_128"
        | "MP4_256"
        | "FLAC_FLAC"
        | "MP4_FLAC"
        | "FLAC_FLAC_24"
        | "MP4_FLAC_24";
    } = {}
  ): Promise<TrackAudio> {
    const { quality = "best" } = options;
    const id = normalizeTrackId(trackId);
    const cacheKey = `audio:${id}:${quality}`;

    return this.dedupe(cacheKey, async () => {
      const playback = await this.playback.getPlaybackInfo(id);

      const mediaKey = Object.keys(playback.media)[0];
      const item = playback.media[mediaKey]?.item;
      let files =
        item?.manifest?.file_ids_mp4 || item?.manifest?.file_ids_mp4flac || [];

      if (quality !== "best") {
        const map: Record<string, string[]> = {
          OGG_VORBIS_96: ["0"],
          OGG_VORBIS_160: ["1"],
          OGG_VORBIS_320: ["2"],
          MP4_128: ["10"],
          MP4_256: ["11"],
          FLAC_FLAC: ["16"],
          MP4_FLAC: ["17"],
          FLAC_FLAC_24: ["22"],
          MP4_FLAC_24: ["23"]
        };
        const allowed = map[quality] || [];
        if (allowed.length) {
          files = files.filter((f: any) => allowed.includes(f.format));
        }
      }

      if (files.length === 0) {
        files =
          item?.manifest?.file_ids_mp4 ||
          item?.manifest?.file_ids_mp4flac ||
          [];
      }

      const urls: Array<{ quality: string; fileId: string; url: string }> = [];
      for (const file of files) {
        const url = await this.resolveAudioFile(file.format, file.file_id);
        if (url) {
          urls.push({
            quality: this.getQualityLabel(file.format),
            fileId: file.file_id,
            url
          });
        }
      }

      return {
        files: files.map((f: any) => ({
          format: f.format,
          fileId: f.file_id,
          bitrate: f.bitrate,
          quality: f.audio_quality
        })),
        urls
      };
    });
  }

  async search(query: string, limit: number = 20) {
    await this.auth.initialize();

    const cacheKey = `search:${query}:${limit}`;
    return this.dedupe(cacheKey, async () => {
      if (this.searchCache.has(cacheKey)) {
        return this.searchCache.get(cacheKey);
      }

      const req = new Request({
        scheme: "https",
        host: "api.spotify.com",
        port: 443,
        path: "/v1/search",
        query: {
          q: query,
          type: "track,album,artist",
          limit: limit.toString(),
          market: "from_token"
        },
        headers: {
          Authorization: `Bearer ${this.auth.getUser().token}`,
          "Content-Type": "application/json"
        }
      });

      const res = await this.http.get<any>(req, "json");
      this.searchCache.set(cacheKey, res);
      return res;
    });
  }

  getHeaders() {
    return this.auth.getHeaders();
  }

  getCdnHeaders() {
    return this.auth.getCdnHeaders();
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

  private async resolveAudioFile(
    formatId: string,
    fileId: string
  ): Promise<string | null> {
    const cacheKey = `${formatId}:${fileId}`;

    return this.dedupe(cacheKey, async () => {
      if (this.resolveCashe.has(cacheKey)) {
        const cached = this.resolveCashe.get(cacheKey);
        return cached ? cached.trim() : null;
      }
      const req = new Request({
        scheme: "https",
        host: "spclient.wg.spotify.com",
        port: 443,
        path: `/storage-resolve/v2/files/audio/interactive/${formatId}/${fileId}`,
        query: {
          version: "10000000",
          product: "9",
          platform: "39",
          alt: "json"
        },
        headers: this.auth.getHeaders()
      });
      const res = await this.http.get<any>(req, "json");
      const rawUrl = res?.cdnurl?.[0] || res?.url;
      if (!rawUrl) return null;
      const url = rawUrl.trim();
      this.resolveCashe.set(cacheKey, url);
      return url;
    });
  }

  private static readonly FORMAT_LABELS: Record<string, string> = {
    "0": "OGG_VORBIS_96",
    "1": "OGG_VORBIS_160",
    "2": "OGG_VORBIS_320",
    "10": "MP4_128",
    "11": "MP4_256",
    "16": "FLAC_FLAC",
    "17": "MP4_FLAC",
    "22": "FLAC_FLAC_24",
    "23": "MP4_FLAC_24"
  };

  private getQualityLabel(formatId: string): string {
    return SPApi.FORMAT_LABELS[formatId] ?? `unknown(${formatId})`;
  }

  private normalizePlayback(playback: any, trackId: string): TrackMeta {
    const mediaKey = Object.keys(playback.media)[0];
    const item = playback.media[mediaKey]?.item;

    return {
      id: trackId,
      uri: `spotify:track:${trackId}`,
      name: item?.metadata?.name || "Unknown",
      duration_ms: item?.metadata?.duration?.milliseconds || 0,
      explicit: item?.metadata?.content_rating?.value === "EXPLICIT",
      artists: (item?.metadata?.artist_list || []).map((a: any) => ({
        id: a.gid,
        name: a.name,
        uri: `spotify:artist:${a.gid}`
      })),
      album: {
        id: item?.metadata?.album?.gid || "",
        name: item?.metadata?.album?.name || "Unknown",
        uri: `spotify:album:${item?.metadata?.album?.gid || ""}`,
        images: [],
        release_date: item?.metadata?.album?.date?.year?.toString() || ""
      }
    };
  }
}

export default SPApi;
