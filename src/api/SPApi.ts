import { HyperClient } from "hyperttp";
import { CacheManager } from "hcacher";
import { AuthManager, PlaybackManager, normalizeTrackId } from "../core/index.js";
import type {
  SpotifyAlbum,
  SpotifyAlbumDetails,
  SpotifyPlaylist,
  SpotifyPlaylistDetails,
  SpotifyAlbumTracksPage,
  SpotifyPlaybackResponse,
  SpotifyPlaylistTrack,
  SpotifyPlaylistTracksPage,
  TrackMeta,
  TrackAudio,
} from "../core/index.js";

const MAX_AUTOMATIC_RETRY_DELAY_MS = 5_000;

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
  private collectionCache = new CacheManager<SpotifyAlbumDetails | SpotifyPlaylistDetails>({
    maxSize: 100,
    ttl: 60_000,
  });
  private collectionMetadataCache = new CacheManager<SpotifyAlbum | SpotifyPlaylist>({
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

  async getAlbum(
    albumId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyAlbumDetails> {
    const id = this.normalizeCollectionId(albumId, "album");
    const maxTracks = this.collectionLimit(options.maxTracks);
    const key = `album-details:${id}:${maxTracks}`;
    return this.dedupe(key, async () => {
      const cached = this.collectionCache.get(key);
      if (cached) return cached as SpotifyAlbumDetails;
      const album = await this.getCollectionMetadata<SpotifyAlbum>("album", id);
      const tracks = await this.getAlbumTracks(id, { maxTracks });
      const result = { ...album, tracks };
      this.collectionCache.set(key, result);
      return result;
    });
  }

  async getPlaylist(
    playlistId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyPlaylistDetails> {
    const id = this.normalizeCollectionId(playlistId, "playlist");
    const maxTracks = this.collectionLimit(options.maxTracks);
    const key = `playlist-details:${id}:${maxTracks}`;
    return this.dedupe(key, async () => {
      const cached = this.collectionCache.get(key);
      if (cached) return cached as SpotifyPlaylistDetails;
      const playlist = await this.getCollectionMetadata<SpotifyPlaylist>("playlist", id);
      const tracks = await this.getPlaylistTracks(id, { maxTracks });
      const result = { ...playlist, tracks };
      this.collectionCache.set(key, result);
      return result;
    });
  }

  private normalizeCollectionId(input: string, type: "album" | "playlist"): string {
    const value = input.trim();
    const uri = value.match(new RegExp(`^spotify:${type}:([a-zA-Z0-9]+)$`));
    if (uri?.[1]) return uri[1];
    if (/^[a-zA-Z0-9]+$/.test(value)) return value;
    try {
      const url = new URL(value);
      const match = url.pathname.match(new RegExp(`^/(?:intl-[^/]+/)?${type}/([a-zA-Z0-9]+)/?$`));
      if (url.protocol === "https:" && url.hostname === "open.spotify.com" && match?.[1]) {
        return match[1];
      }
    } catch {
      // Non-URL input is rejected below.
    }
    throw new Error(`Invalid Spotify ${type} ID, URI, or URL`);
  }

  private collectionLimit(value = 1_000): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("maxTracks must be a non-negative integer");
    }
    return value;
  }

  private async getCollectionMetadata<T extends SpotifyAlbum | SpotifyPlaylist>(
    type: "album" | "playlist",
    id: string,
  ): Promise<T> {
    const key = `${type}:${id}`;
    const cached = this.collectionMetadataCache.get(key);
    if (cached) return cached as T;
    await this.auth.initialize();
    const request = () =>
      this.http.rest.get<T>(`https://api.spotify.com/v1/${type}s/${encodeURIComponent(id)}`, {
        timeout: 15_000,
        query: { market: "from_token" },
        headers: { Authorization: `Bearer ${this.auth.getUser().token}` },
      });
    let response = await request();
    for (let retry = 0; response.status === 429 && retry < 2; retry += 1) {
      const header = response.headers["retry-after"];
      const seconds = Array.isArray(header) ? header[0] : header;
      const delay = Number(seconds) * 1_000;
      if (!Number.isFinite(delay) || delay <= 0 || delay > MAX_AUTOMATIC_RETRY_DELAY_MS) break;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      response = await request();
    }
    if (!response.ok) {
      const header = response.headers["retry-after"];
      const seconds = Array.isArray(header) ? header[0] : header;
      throw new Error(
        response.status === 429
          ? `Spotify ${type} request is rate limited${seconds ? `; retry after ${seconds}s` : ""}`
          : `Spotify ${type} request failed with HTTP ${response.status}`,
      );
    }
    this.collectionMetadataCache.set(key, response.data);
    return response.data;
  }

  async getPlaylistTracks(
    playlistId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyPlaylistTrack[]> {
    const id = this.normalizeCollectionId(playlistId, "playlist");
    const maxTracks = this.collectionLimit(options.maxTracks);
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
              timeout: 15_000,
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

          if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > MAX_AUTOMATIC_RETRY_DELAY_MS)
            break;

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

        if (!page.next || page.items.length === 0) break;
      }

      this.playlistCache.set(cacheKey, tracks);
      return tracks;
    });
  }

  async getAlbumTracks(
    albumId: string,
    options: { maxTracks?: number } = {},
  ): Promise<SpotifyPlaylistTrack[]> {
    const id = this.normalizeCollectionId(albumId, "album");
    const maxTracks = this.collectionLimit(options.maxTracks);
    const cacheKey = `album:${id}:${maxTracks}`;

    await this.auth.initialize();

    return this.dedupe(cacheKey, async () => {
      const cached = this.albumCache.get(cacheKey);
      if (cached) return cached;

      const album = await this.getCollectionMetadata<SpotifyAlbum>("album", id);
      const headers = { Authorization: `Bearer ${this.auth.getUser().token}` };
      const tracks: SpotifyPlaylistTrack[] = [];
      const pageSize = 50;

      for (let offset = 0; tracks.length < maxTracks; offset += pageSize) {
        const requestPage = () =>
          this.http.rest.get<SpotifyAlbumTracksPage>(
            `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}/tracks`,
            {
              timeout: 15_000,
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

          if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > MAX_AUTOMATIC_RETRY_DELAY_MS)
            break;

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

        if (!page.next || page.items.length === 0) break;
      }

      this.albumCache.set(cacheKey, tracks);
      return tracks;
    });
  }

  async search(query: string, limit = 10) {
    const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
    const normalizedQuery = query.trim();
    const cacheKey = `search:${normalizedQuery}:${safeLimit}`;

    if (!Number.isFinite(limit)) {
      throw new Error("Search limit must be finite");
    }
    if (!normalizedQuery) {
      throw new Error("Search query cannot be empty");
    }

    return this.dedupe(cacheKey, async () => {
      if (this.searchCache.has(cacheKey)) {
        return this.searchCache.get(cacheKey);
      }

      await this.auth.initialize();
      const response = await this.http.rest.get<any>("https://api.spotify.com/v1/search", {
        timeout: 15_000,
        query: {
          q: normalizedQuery,
          type: "track,album,artist",
          limit: String(safeLimit),
          market: "from_token",
        },
        headers: {
          Authorization: `Bearer ${this.auth.getUser().token}`,
          "Content-Type": "application/json",
        },
      });
      const res = response.data;
      if (response.status === 429) {
        const header = response.headers["retry-after"];
        const seconds = Array.isArray(header) ? header[0] : header;
        throw new Error(
          `Spotify search is rate limited${seconds ? `; retry after ${seconds}s` : ""}`,
        );
      }
      if (!response.ok || res?.error) {
        throw new Error(
          `Spotify search failed: ${res?.error?.message ?? `HTTP ${response.status}`}`,
        );
      }

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
