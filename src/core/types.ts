export interface SpotifyUser {
  token: string;
  clientToken: string;
  expiresAt: number;
}

export type SpotifyId = string;

export interface Image {
  url: string;
  width: number | null;
  height: number | null;
}

export interface TrackFile {
  format: string;
  fileId: string;
  bitrate?: number;
  quality?: string;
}

export interface TrackUrl {
  quality: string;
  fileId: string;
  url: string;
  decryptedBuffer?: Buffer;
  blobUrl?: string;
}

export interface TrackAudio {
  files: TrackFile[];
  urls: TrackUrl[];
}

export interface TrackMeta {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: Array<{ id: string; name: string; uri: string }>;
  album: {
    id: string;
    name: string;
    uri: string;
    images: Image[];
    release_date: string;
  };
}

export interface SpotifyPlaylistTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: Array<{ id: string; name: string }>;
  album: {
    name: string;
    images: Image[];
  };
}

export interface SpotifyPlaylistTracksPage {
  items: Array<{ track: SpotifyPlaylistTrack | null }>;
  next: string | null;
  total: number;
}

export interface SpotifyAlbumTracksPage {
  items: Array<Omit<SpotifyPlaylistTrack, "album">>;
  next: string | null;
  total: number;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: Image[];
}

export interface ClientTokenResponse {
  granted_token?: {
    token: string;
    expiration_ts?: number;
  };
}

export interface SpotifyPlaybackAuthor {
  name?: string;
  uri?: string;
}

export interface SpotifyPlaybackImage {
  url?: string;
  width?: number;
  height?: number;
}

export interface SpotifyPlaybackMetadata {
  uri?: string;
  name?: string;
  group_name?: string;
  group_uri?: string;
  images?: SpotifyPlaybackImage[];
  duration?: number | { milliseconds?: number };
  is_explicit?: boolean;
  authors?: SpotifyPlaybackAuthor[];
  artist_list?: Array<{ gid?: string; name?: string }>;
  content_rating?: { value?: string };
  album?: {
    gid?: string;
    name?: string;
    date?: { year?: number };
  };
}

export interface SpotifyPlaybackResponse {
  media: Record<
    string,
    {
      item?: {
        metadata?: SpotifyPlaybackMetadata;
        manifest?: {
          file_ids_mp4?: Array<{
            format: string;
            file_id: string;
            bitrate?: number;
          }>;
          file_ids_mp4flac?: Array<{
            format: string;
            file_id: string;
            bitrate?: number;
          }>;
        };
      };
    }
  >;
  error_code?: number;
}
