// ============================================
// Базовые сущности
// ============================================

export interface SpotifyUser {
  token: string; // Bearer токен
  clientToken: string; // x-client-token
  uri?: string;
  username?: string;
}

export type SpotifyId = string; // Base62 строка (например, 4iV5W91S6nYEAO5R31B9Ek)

export interface Image {
  url: string;
  width: number | null;
  height: number | null;
}

// ============================================
// Треки и Альбомы
// ============================================

export interface SpotifyTrack {
  id: SpotifyId;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  preview_url: string | null;
  album: SpotifyAlbumMinimal;
  artists: SpotifyArtistMinimal[];
}

export interface SpotifyArtistMinimal {
  id: SpotifyId;
  uri: string;
  name: string;
}

export interface SpotifyAlbumMinimal {
  id: SpotifyId;
  uri: string;
  name: string;
  images: Image[];
  release_date: string;
}

// ============================================
// Плейлисты (Pathfinder Response)
// ============================================

export interface SpotifyPlaylist {
  uri: string;
  name: string;
  description: string;
  images: Image[];
  owner: {
    display_name: string;
    uri: string;
  };
  tracks: {
    totalCount: number;
    items: Array<{
      added_at: string;
      track: SpotifyTrack;
    }>;
  };
}

// ============================================
// Поиск (Search Response)
// ============================================

export interface SearchResponse {
  data: {
    searchV2: {
      tracksV2: {
        totalCount: number;
        items: Array<{
          matchedFields: string[];
          item: {
            data: SpotifyTrack;
          };
        }>;
      };
      albumsV2: {
        totalCount: number;
        items: Array<{
          data: SpotifyAlbumMinimal;
        }>;
      };
      artists: {
        totalCount: number;
        items: Array<{
          data: SpotifyArtistMinimal & { visuals: { avatarImage: Image } };
        }>;
      };
    };
  };
}

// ============================================
// Опции запросов (аналог SearchOptions в YMApi)
// ============================================

export interface SpotifySearchOptions {
  limit?: number;
  offset?: number;
  type?: string[]; // track, album, artist, playlist, podcast
}

/**
 * Вспомогательный тип для ответов GraphQL
 */
export interface PathfinderResponse<T> {
  data: T;
  extensions?: {
    cacheControl?: any;
  };
}
