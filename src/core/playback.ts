import { HyperClient } from "hyperttp";
import { CacheManager } from "hcacher";
import { AuthManager } from "./auth.js";
import type { SpotifyPlaybackResponse, TrackUrl, TrackAudio } from "./types.js";
import { CLIENT_VERSION } from "./constants.js";

const PLAYBACK_QUERY = {
  manifestFileFormat: `file_ids_mp4`,
  manifestFileFormatFlac: `file_ids_mp4flac`
};

export class PlaybackManager {
  private http: HyperClient;
  private auth: AuthManager;

  private cache = {
    playback: new CacheManager<SpotifyPlaybackResponse>({
      maxSize: 300,
      ttl: 120_000
    }),
    audio: new CacheManager<TrackAudio>({ maxSize: 1000, ttl: 600_000 })
  };

  private resolveCache = new CacheManager<string>({
    maxSize: 5000,
    ttl: 1000 * 60 * 60
  });

  private inflight = new Map<string, Promise<any>>();

  constructor(http: HyperClient, auth: AuthManager) {
    this.http = http;
    this.auth = auth;
  }

  async getPlaybackInfo(trackId: string): Promise<SpotifyPlaybackResponse> {
    await this.auth.initialize();

    const cached = this.cache.playback.get(trackId);
    if (cached) return cached;

    return this.dedupe(`playback:${trackId}`, async () => {
      const res = await this.http.get<SpotifyPlaybackResponse>(
        `https://spclient.wg.spotify.com/track-playback/v1/media/spotify:track:${trackId}`,
        {
          query: PLAYBACK_QUERY,
          headers: {
            ...this.auth.getHeaders(),
            "App-Platform": "WebPlayer",
            "Spotify-App-Version": CLIENT_VERSION
          },
          responseType: "json"
        }
      );

      if (res?.error_code === 8) {
        throw new Error("INVALID_USER");
      }

      this.cache.playback.set(trackId, res);
      return res;
    });
  }

  async getAudioUrls(trackId: string): Promise<TrackAudio> {
    await this.auth.initialize();

    const cached = this.cache.audio.get(trackId);
    if (cached) return cached;

    return this.dedupe(`audio:${trackId}`, async () => {
      const playback = await this.getPlaybackInfo(trackId);

      const mediaKey = Object.keys(playback.media)[0];
      const item = mediaKey ? playback.media[mediaKey]?.item : undefined;
      const files =
        item?.manifest?.file_ids_mp4flac || item?.manifest?.file_ids_mp4 || [];

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

      const result: TrackAudio = {
        files: files.map((f: any) => ({
          format: f.format,
          fileId: f.file_id,
          bitrate: f.bitrate,
          quality: f.audio_quality
        })),
        urls: urls as TrackUrl[]
      };

      this.cache.audio.set(trackId, result);
      return result;
    });
  }

  private async resolveAudioFile(
    formatId: string,
    fileId: string
  ): Promise<string | null> {
    const cacheKey = `${formatId}:${fileId}`;
    if (this.resolveCache.has(cacheKey)) {
      return this.resolveCache.get(cacheKey)!;
    }

    const hosts = ["spclient.wg.spotify.com"];

    for (const host of hosts) {
      try {
        const res = await this.http.get<any>(
          `https://${host}/storage-resolve/v2/files/audio/interactive/${formatId}/${fileId}`,
          {
            query: {
              version: "10000000",
              product: "9",
              platform: "39",
              alt: "json"
            },
            headers: this.auth.getHeaders(),
            responseType: "json"
          }
        );
        const url = res?.cdnurl?.[0] || res?.url;

        if (url) {
          this.resolveCache.set(cacheKey, url);
          return url;
        }
      } catch (err: any) {
        console.warn(`[resolve] ${host} failed for ${formatId}`, err?.message);
      }
    }
    return null;
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
    return PlaybackManager.FORMAT_LABELS[formatId] ?? `unknown(${formatId})`;
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
}
