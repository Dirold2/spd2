# Changelog

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
