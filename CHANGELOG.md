# Changelog

## [1.3.0] — 2026-11-03

### Added

- `getAlbum()` and `getPlaylist()` return collection metadata with a normalized `tracks` array.
- Collection methods accept Spotify IDs, URIs, and URLs, including localized URLs.
- Vitest coverage for collection metadata, pagination, caching, validation, and rate limits.

### Changed

- Updated `hyperttp` to `^0.7.4`.
- Search now trims queries and limits results to between 1 and 10 per resource type, with a default of 10.

### Fixed

- Reject empty search queries and report Spotify search API errors.
- Updated album and playlist examples to use `getAlbum()` and `getPlaylist()`.
- Validate collection `maxTracks` values and continue pagination past pages containing only unavailable tracks.

## [1.2.0] — 2026-10-16

### Added

- `SPApi.getPlaylistTracks()` for loading playlist tracks with pagination and a configurable `maxTracks` limit.
- `SPApi.getAlbumTracks()` for loading album tracks, including album title and cover images.
- Retry handling for Spotify Web API `429 Too Many Requests` responses that honour short `Retry-After` values.
- Normalization for current Spotify playback metadata, including artists, duration, explicit status, album information, and cover images.

### Changed

- Updated `hyperttp` to `^0.5.6`.
- Replaced `lru-cache` with `hcacher` `^0.3.0`.
- Migrated HTTP usage to `HyperClient`.
- Disabled automatic HTTP `Digest` generation for Spotify requests because Spotify's client-token endpoint rejects it.
- Updated cache configuration from `max` to `maxSize` to match `hcacher`.

### Fixed

- Parse artists from `metadata.authors`, with compatibility for the legacy `artist_list` response shape.
- Parse current playback duration, explicit status, album metadata, and images while preserving legacy response compatibility.
