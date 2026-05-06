export const TIMEOUT = 30;
export const HOME_PAGE_URL = "https://open.spotify.com/";
export const COOKIE_DOMAIN = ".spotify.com";
export const CLIENT_VERSION = "1.2.87.27.ga2033a72";

export const LYRICS_API_URL =
  "https://spclient.wg.spotify.com/color-lyrics/v2/track/{track_id}";

export const GID_METADATA_URL =
  "https://spclient.wg.spotify.com/metadata/4/{media_type}/{gid}?market=from_token";

export const PATHFINDER_API_URL =
  "https://api-partner.spotify.com/pathfinder/v2/query";

export const VIDEO_MANIFEST_API_URL =
  "https://gue1-spclient.spotify.com/manifests/v9/json/sources/{file_id}/options/supports_drm";

export const PLAYBACK_INFO_API_URL =
  "https://gue1-spclient.spotify.com/track-playback/v1/media/spotify:{media_type}:{media_id}";

export const PLAYPLAY_LICENSE_API_URL =
  "https://gew4-spclient.spotify.com/playplay/v1/key/{file_id}";

export const EXTENDED_METADATA_API_URL =
  "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata";

export const WIDEVINE_LICENSE_API_URL =
  "https://gue1-spclient.spotify.com/widevine-license/v1/{type}/license";

export const SEEK_TABLE_API_URL =
  "https://seektables.scdn.co/seektable/{file_id}.json";

export const TRACK_CREDITS_API_URL =
  "https://spclient.wg.spotify.com/track-credits-view/v0/experimental/{track_id}/credits";

export const AUDIO_STREAM_URLS_API_URL =
  "https://gue1-spclient.spotify.com/storage-resolve/v2/files/audio/interactive/{format_id}/{file_id}?version=10000000&product=9&platform=39&alt=json";

export const SERVER_TIME_URL = "https://open.spotify.com/api/server-time";
export const SESSION_TOKEN_URL = "https://open.spotify.com/api/token";
export const CLIENT_TOKEN_URL =
  "https://clienttoken.spotify.com/v1/clienttoken";

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRETS_URL =
  "https://git.gay/thereallo/totp-secrets/raw/branch/main/secrets/secretDict.json";

export const DEVICE_AUTH_URL =
  "https://accounts.spotify.com/oauth2/device/authorize";
export const DEVICE_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const DEVICE_RESOLVE_URL =
  "https://accounts.spotify.com/pair/api/resolve";

export const DEVICE_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd";
export const DEVICE_SCOPE =
  "app-remote-control,playlist-modify,playlist-modify-private,playlist-modify-public,playlist-read,playlist-read-collaborative,playlist-read-private,streaming,transfer-auth-session,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify,user-modify-playback-state,user-modify-private,user-personalized,user-read-birthdate,user-read-currently-playing,user-read-email,user-read-play-history,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read";

export const DEVICE_FLOW_USER_AGENT =
  "Spotify/128700414 Win32_x86_64/Windows 10 (10.0.26100; x64)";

export const DEVICE_CLIENT_TOKEN =
  "AACGR5f9VPMzpwuXCfxLbnOaoBIv84PHvFosqXCe+MGx58b89UuUejjOoKC34lVsZYXREPW2yd29t6WY2INhRNWWqZn13bGfmoGowxTumhU5QT7dXvmfIgh0EoF3liPLY6p1+655XJzvtkOUtM6eIZhuJRF2rJdxePi5ft5rulsB3pO04M6v9MHZxEiAdfN8hBCOZuzggdECz8cc0U54cHFZfSuraBldNGR9sEnhhIyYIYJ9MCMAo6261/TiNCL2g==";
