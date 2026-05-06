# SPD2 (Spotify Downloader 2)

## 🚧 Status

- ✅ **Authentication**: TOTP-based login via `sp_dc` cookie.
- ✅ **Metadata**: Full track/album/artist info retrieval.
- ✅ **Audio Resolution**: CDN URL resolution for multiple qualities (OGG, MP4, FLAC).
- ✅ **Architecture**: Clean separation between `Core` (logic) and `API` (client).

## 🏗 Architecture

The project is split into two main layers:

### 1. Core (`src/core`)

Low-level logic independent of the high-level client.

- **AuthManager**: Handles TOTP generation, session tokens, and client tokens.
- **PlaybackManager**: Manages track playback info and CDN URL resolution.
- **Types**: Strict TypeScript definitions for Spotify entities.

### 2. API (`src/api`)

High-level client (`SPApi`) for easy consumption.

- Aggregates core modules.
- Provides methods like `getTrack()`, `getAudio()`, `search()`.
- Handles caching and request deduplication.

## 📦 Requirements

- **Runtime**: [Bun](https://bun.sh/) (v1.3.11+) or Node.js v20+

## 🛠 Installation

```bash
# Install JS dependencies
bun install
```

## ⚙️ Configuration

Create a `.env` file in the root:

```env
SP_DC=your_sp_dc_cookie_here
```

## 🚀 Usage

### Basic Example

```typescript
import SPApi from "./src/api/SPApi";

const api = new SPApi(process.env.SP_DC);

async function main() {
  await api.initialize();

  // Get Metadata
  const track = await api.getTrack("4cOdK2wGLETKBWATPvgKoq");
  console.log("Track:", track.name);

  // Get Audio URLs
  const audio = await api.getAudio("4cOdK2wGLETKBWATPvgKoq", {
    quality: "MP4_256"
  });
  console.log("URLs:", audio.urls);
}

main();
```

### Available Methods

| Method                  | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `initialize()`          | Authenticates and fetches tokens.                 |
| `getTrack(id)`          | Returns metadata (name, artist, album, duration). |
| `getAudio(id, options)` | Returns file info and resolved CDN URLs.          |
| `search(query, limit)`  | Searches for tracks, albums, and artists.         |
| `getPlaybackInfo(id)`   | Raw playback data from Spotify API.               |

## 📂 Project Structure

```text
src/
├── api/          # High-level SPApi client
├── core/         # Auth, Playback, Types
├── scripts/      # Python helpers (decryption)
├── config.ts     # Global configuration
└── types.ts      # Shared interfaces
example/          # Usage examples
```

## ⚠️ Disclaimer

This project is for educational purposes only. Downloading copyrighted music without permission may violate Spotify's Terms of Service and local laws. Use responsibly.

## 🤝 Contributing

Issues and PRs are welcome! Specifically help with:

- Pure TS/WASM implementation of the key emulation (removing Python dependency).
- Better error handling for token refreshes.
- Support for podcasts and episodes.
