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

export interface ClientTokenResponse {
  granted_token?: {
    token: string;
    expiration_ts?: number;
  };
}

export interface SpotifyPlaybackResponse {
  media: Record<
    string,
    {
      item?: {
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