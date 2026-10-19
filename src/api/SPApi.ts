import { HyperClient } from "hyperttp";
import { CacheManager } from "hcacher";
import { AuthManager, PlaybackManager, normalizeTrackId } from "../core/index.js";
import type {
  SpotifyAlbum,
  SpotifyAlbumTracksPage,
  SpotifyPlaybackResponse,
  SpotifyPlaylistTrack,
  SpotifyPlaylistTracksPage,
  TrackMeta,
  TrackAudio,
} from "../core/index.js";

export class SPApi {
  private http: HyperClient;
  private auth: AuthManager;
  private playback: PlaybackManager;

  private searchCache = new CacheManager<any>({ maxSize: 200, ttl: 60_000 });
  private playlistCache = new CacheManager<SpotifyPlaylistTrack[]>({
    maxSize: 100,
    ttl: 60_000,
  });
  private albumCache = new CacheManager<SpotifyPlaylistTrack[]>({
    maxSize: 100,
    ttl: 60_000,
  });
  private resolveCashe = new CacheManager<string>({ maxSize: 200, ttl: 60_000 });
  private inflight = new Map<string, Promise<any>>();

  constructor(spDc?: string, httpClient?: HyperClient) {
    this.http = httpClient || new HyperClient({ crypto: { digest: false } });
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
    } = {},
  ): Promise<TrackAudio> {
    const { quality = "best" } = options;
    const id = normalizeTrackId(trackId);
    const cacheKey = `audio:${id}:${quality}`;

    return this.dedupe(cacheKey, async () => {
      const playback = await this.playback.getPlaybackInfo(id);

      const mediaKey = Object.keys(playback.media)[0];
      const item = mediaKey ? playback.media[mediaKey]?.item : undefined;
      let files = item?.manifest?.file_ids_mp4 || item?.manifest?.file_ids_mp4flac || [];

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
          MP4_FLAC_24: ["23"],
        };
        const allowed = map[quality] || [];
        if (allowed.length) {
          files = files.filter((f: any) => allowed.includes(f.format));
        }
      }

      if (files.length === 0) {
        files = item?.manifest?.file_ids_mp4 || item?.manifest?.file_ids_mp4flac || [];
      }

      const urls: Array<{ quality: string; fileId: string; url: string }> = [];
      for (const file of files) {
        const url = await this.resolveAudioFile(file.format, file.file_id);
        if (url) {
          urls.push({
            quality: this.getQualityLabel(file.format),
            fileId: file.file_id,
            url,
          });
        }
      }

      return {
        files: files.map((f: any) => ({
          format: f.format,
          fileId: f.file_id,
          bitrate: f.bitrate,
          quality: f.audio_quality,
        })),
        urls,
      };
    });
  }

  async getPlaylistTracks(
    playlistId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyPlaylistTrack[]> {
    const id = playlistId.replace(/^spotify:playlist:/, "");
    const maxTracks = options.maxTracks ?? 1_000;
    const cacheKey = `playlist:${id}:${maxTracks}`;

    await this.auth.initialize();

    return this.dedupe(cacheKey, async () => {
      const cached = this.playlistCache.get(cacheKey);
      if (cached) return cached;

      const tracks: SpotifyPlaylistTrack[] = [];
      const pageSize = 100;

      for (let offset = 0; tracks.length < maxTracks; offset += pageSize) {
        const requestPage = () =>
          this.http.rest.get<SpotifyPlaylistTracksPage>(
            `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks`,
            {
              query: {
                additional_types: "track",
                limit: String(Math.min(pageSize, maxTracks - tracks.length)),
                market: "from_token",
                offset: String(offset),
              },
              headers: {
                Authorization: `Bearer ${this.auth.getUser().token}`,
                "Content-Type": "application/json",
              },
            },
          );

        let response = await requestPage();
        for (let retry = 0; response.status === 429 && retry < 2; retry += 1) {
          const retryAfter = response.headers["retry-after"];
          const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          const delayMs = Number(seconds) * 1_000;

          if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > 60_000) break;

          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          response = await requestPage();
        }

        if (response.status === 429) {
          const retryAfter = response.headers["retry-after"];
          const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          throw new Error(
            `Spotify playlist request is rate limited${seconds ? `; retry after ${seconds}s` : ""}`,
          );
        }

        if (!response.ok) {
          throw new Error(`Spotify playlist request failed with HTTP ${response.status}`);
        }

        const page = response.data;
        const pageTracks = page.items
          .map((item) => item.track)
          .filter((track): track is SpotifyPlaylistTrack => Boolean(track?.id));
        tracks.push(...pageTracks);

        if (!page.next || pageTracks.length === 0) break;
      }

      this.playlistCache.set(cacheKey, tracks);
      return tracks;
    });
  }

  async getAlbumTracks(
    albumId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyPlaylistTrack[]> {
    const id = albumId.replace(/^spotify:album:/, "");
    const maxTracks = options.maxTracks ?? 1_000;
    const cacheKey = `album:${id}:${maxTracks}`;

    await this.auth.initialize();

    return this.dedupe(cacheKey, async () => {
      const cached = this.albumCache.get(cacheKey);
      if (cached) return cached;

      const headers = {
        Authorization: `Bearer ${this.auth.getUser().token}`,
        "Content-Type": "application/json",
      };
      const requestAlbum = () =>
        this.http.rest.get<SpotifyAlbum>(
          `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`,
          { query: { market: "from_token" }, headers },
        );

      let albumResponse = await requestAlbum();
      for (let retry = 0; albumResponse.status === 429 && retry < 2; retry += 1) {
        const retryAfter = albumResponse.headers["retry-after"];
        const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
        const delayMs = Number(seconds) * 1_000;

        if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > 60_000) break;

        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        albumResponse = await requestAlbum();
      }

      if (albumResponse.status === 429) {
        const retryAfter = albumResponse.headers["retry-after"];
        const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
        throw new Error(
          `Spotify album request is rate limited${seconds ? `; retry after ${seconds}s` : ""}`,
        );
      }

      if (!albumResponse.ok) {
        throw new Error(`Spotify album request failed with HTTP ${albumResponse.status}`);
      }

      const album = albumResponse.data;
      const tracks: SpotifyPlaylistTrack[] = [];
      const pageSize = 50;

      for (let offset = 0; tracks.length < maxTracks; offset += pageSize) {
        const requestPage = () =>
          this.http.rest.get<SpotifyAlbumTracksPage>(
            `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}/tracks`,
            {
              query: {
                limit: String(Math.min(pageSize, maxTracks - tracks.length)),
                market: "from_token",
                offset: String(offset),
              },
              headers,
            },
          );

        let response = await requestPage();
        for (let retry = 0; response.status === 429 && retry < 2; retry += 1) {
          const retryAfter = response.headers["retry-after"];
          const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          const delayMs = Number(seconds) * 1_000;

          if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > 60_000) break;

          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          response = await requestPage();
        }

        if (response.status === 429) {
          const retryAfter = response.headers["retry-after"];
          const seconds = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          throw new Error(
            `Spotify album request is rate limited${seconds ? `; retry after ${seconds}s` : ""}`,
          );
        }

        if (!response.ok) {
          throw new Error(`Spotify album tracks request failed with HTTP ${response.status}`);
        }

        const page = response.data;
        const pageTracks = page.items.filter((track) => Boolean(track?.id));
        tracks.push(
          ...pageTracks.map((track) => ({
            ...track,
            album: { name: album.name, images: album.images },
          })),
        );

        if (!page.next || pageTracks.length === 0) break;
      }

      this.albumCache.set(cacheKey, tracks);
      return tracks;
    });
  }

  async search(query: string, limit: number = 20) {
    await this.auth.initialize();

    const cacheKey = `search:${query}:${limit}`;
    return this.dedupe(cacheKey, async () => {
      if (this.searchCache.has(cacheKey)) {
        return this.searchCache.get(cacheKey);
      }

      const res = await this.http.get<any>("https://api.spotify.com/v1/search", {
        query: {
          q: query,
          type: "track,album,artist",
          limit: limit.toString(),
          market: "from_token",
        },
        headers: {
          Authorization: `Bearer ${this.auth.getUser().token}`,
          "Content-Type": "application/json",
        },
        responseType: "json",
      });
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

  private async resolveAudioFile(formatId: string, fileId: string): Promise<string | null> {
    const cacheKey = `${formatId}:${fileId}`;

    return this.dedupe(cacheKey, async () => {
      if (this.resolveCashe.has(cacheKey)) {
        const cached = this.resolveCashe.get(cacheKey);
        return cached ? cached.trim() : null;
      }
      const res = await this.http.get<any>(
        `https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/${formatId}/${fileId}`,
        {
          query: {
            version: "10000000",
            product: "9",
            platform: "39",
            alt: "json",
          },
          headers: this.auth.getHeaders(),
          responseType: "json",
        },
      );
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
    "23": "MP4_FLAC_24",
  };

  private getQualityLabel(formatId: string): string {
    return SPApi.FORMAT_LABELS[formatId] ?? `unknown(${formatId})`;
  }

  private normalizePlayback(playback: SpotifyPlaybackResponse, trackId: string): TrackMeta {
    const mediaKey = Object.keys(playback.media)[0];
    const metadata = mediaKey ? playback.media[mediaKey]?.item?.metadata : undefined;
    const artists = metadata?.authors?.length
      ? metadata.authors.map((author) => ({
          id: author.uri?.replace("spotify:artist:", "") ?? "",
          name: author.name ?? "Unknown",
          uri: author.uri ?? "",
        }))
      : (metadata?.artist_list ?? []).map((artist) => ({
          id: artist.gid ?? "",
          name: artist.name ?? "Unknown",
          uri: artist.gid ? `spotify:artist:${artist.gid}` : "",
        }));

    const albumUri =
      metadata?.group_uri ?? (metadata?.album?.gid ? `spotify:album:${metadata.album.gid}` : "");
    const albumId = albumUri.replace(/^spotify:album:/, "");

    return {
      id: trackId,
      uri: `spotify:track:${trackId}`,
      name: metadata?.name || "Unknown",
      duration_ms:
        typeof metadata?.duration === "number"
          ? metadata.duration
          : (metadata?.duration?.milliseconds ?? 0),
      explicit: metadata?.is_explicit ?? metadata?.content_rating?.value === "EXPLICIT",
      artists,
      album: {
        id: albumId,
        name: metadata?.group_name ?? metadata?.album?.name ?? "Unknown",
        uri: albumUri,
        images: (metadata?.images ?? []).flatMap((image) =>
          image.url
            ? [
                {
                  url: image.url,
                  width: image.width ?? null,
                  height: image.height ?? null,
                },
              ]
            : [],
        ),
        release_date: metadata?.album?.date?.year?.toString() || "",
      },
    };
  }
}

export default SPApi;
