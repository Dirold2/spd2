import { afterEach, describe, expect, it, vi } from "vitest";
import type { HyperClient } from "hyperttp";
import { SPApi } from "../src/api/SPApi.js";
import { AuthManager } from "../src/core/auth.js";

const track = {
  id: "track1",
  name: "Track",
  duration_ms: 120000,
  explicit: false,
  artists: [{ id: "artist1", name: "Artist" }],
};
const album = { id: "album1", name: "Album", images: [] };
const playlist = {
  id: "playlist1",
  name: "Playlist",
  description: "Description",
  images: [],
  owner: { id: "user1", display_name: "Owner" },
  public: true,
  collaborative: false,
};
const ok = (data: unknown) => ({ ok: true, status: 200, headers: {}, data });

function setup() {
  vi.spyOn(AuthManager.prototype, "initialize").mockResolvedValue(undefined);
  vi.spyOn(AuthManager.prototype, "getUser").mockReturnValue({
    token: "test-token",
    clientToken: "test-client-token",
    expiresAt: Date.now() + 60000,
  });
  const get = vi.fn();
  const api = new SPApi("", { rest: { get } } as unknown as HyperClient);
  return { api, get };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("collection metadata", () => {
  it("loads album metadata and tracks, reuses metadata and caches URL/URI/ID requests", async () => {
    const { api, get } = setup();
    get
      .mockResolvedValueOnce(ok(album))
      .mockResolvedValueOnce(ok({ items: [track], next: null, total: 1 }));
    const result = await api.getAlbum("https://open.spotify.com/album/album1?si=test");
    expect(result).toEqual({
      ...album,
      tracks: [{ ...track, album: { name: album.name, images: [] } }],
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(await api.getAlbum("spotify:album:album1")).toBe(result);
    expect(await api.getAlbum("album1")).toBe(result);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("loads playlist metadata and preserves track artists and album", async () => {
    const { api, get } = setup();
    const fullTrack = { ...track, album };
    get
      .mockResolvedValueOnce(ok(playlist))
      .mockResolvedValueOnce(
        ok({ items: [{ track: fullTrack }, { track: null }], next: null, total: 2 }),
      );
    expect(await api.getPlaylist("https://open.spotify.com/intl-ru/playlist/playlist1")).toEqual({
      ...playlist,
      tracks: [fullTrack],
    });
    expect(get.mock.calls[1]?.[0]).toBe("https://api.spotify.com/v1/playlists/playlist1/tracks");
  });

  it("deduplicates concurrent requests", async () => {
    const { api, get } = setup();
    get
      .mockResolvedValueOnce(ok(album))
      .mockResolvedValueOnce(ok({ items: [], next: null, total: 0 }));
    const [first, second] = await Promise.all([api.getAlbum("album1"), api.getAlbum("album1")]);
    expect(first).toBe(second);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("honours maxTracks and page size", async () => {
    const { api, get } = setup();
    get
      .mockResolvedValueOnce(ok(album))
      .mockResolvedValueOnce(
        ok({ items: Array.from({ length: 50 }, () => track), next: "next", total: 51 }),
      )
      .mockResolvedValueOnce(ok({ items: [track], next: null, total: 51 }));
    const result = await api.getAlbum("album1", { maxTracks: 51 });
    expect(result.tracks).toHaveLength(51);
    expect(get.mock.calls[1]?.[1].query).toMatchObject({ limit: "50", offset: "0" });
    expect(get.mock.calls[2]?.[1].query).toMatchObject({ limit: "1", offset: "50" });
  });

  it("continues past playlist pages containing only unavailable tracks", async () => {
    const { api, get } = setup();
    get
      .mockResolvedValueOnce(ok({ items: [{ track: null }], next: "next", total: 101 }))
      .mockResolvedValueOnce(
        ok({ items: [{ track: { ...track, album } }], next: null, total: 101 }),
      );
    expect(await api.getPlaylistTracks("playlist1")).toHaveLength(1);
    expect(get.mock.calls[1]?.[1].query.offset).toBe("100");
  });

  it("allows metadata-only requests with maxTracks zero", async () => {
    const { api, get } = setup();
    get.mockResolvedValueOnce(ok(playlist));
    expect(await api.getPlaylist("playlist1", { maxTracks: 0 })).toEqual({
      ...playlist,
      tracks: [],
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 1.5, NaN, Infinity])(
    "rejects invalid maxTracks %s before requesting",
    async (maxTracks) => {
      const { api, get } = setup();
      await expect(api.getAlbum("album1", { maxTracks })).rejects.toThrow("maxTracks");
      await expect(api.getPlaylist("playlist1", { maxTracks })).rejects.toThrow("maxTracks");
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "spotify:track:track1",
    "https://evil.test/album/album1",
    "https://open.spotify.com/playlist/playlist1",
  ])("rejects invalid album input %s", async (input) => {
    const { api, get } = setup();
    await expect(api.getAlbum(input)).rejects.toThrow("Invalid Spotify album");
    expect(get).not.toHaveBeenCalled();
  });

  it("reports HTTP errors without caching failed requests", async () => {
    const { api, get } = setup();
    get.mockResolvedValueOnce({ ok: false, status: 404, headers: {} });
    await expect(api.getPlaylist("playlist1")).rejects.toThrow("HTTP 404");
    get.mockResolvedValueOnce(ok(playlist));
    expect(await api.getPlaylist("playlist1", { maxTracks: 0 })).toMatchObject(playlist);
  });

  it.each(["album", "playlist", "tracks"])(
    "does not wait for long Retry-After on %s",
    async (kind) => {
      vi.useFakeTimers();
      const { api, get } = setup();
      get.mockResolvedValue({ ok: false, status: 429, headers: { "retry-after": "58" } });
      const pending =
        kind === "album"
          ? api.getAlbum("album1")
          : kind === "playlist"
            ? api.getPlaylist("playlist1")
            : api.getPlaylistTracks("playlist1");
      await expect(pending).rejects.toThrow("retry after 58s");
      expect(get).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(get.mock.calls[0]?.[1].timeout).toBe(15000);
    },
  );

  it("uses real Retry-After for search instead of a fixed 30 seconds", async () => {
    const { api, get } = setup();
    get.mockResolvedValue({ ok: false, status: 429, headers: { "retry-after": "73" } });
    await expect(api.search("Artist")).rejects.toThrow("retry after 73s");
  });

  it("caches successful searches", async () => {
    const { api, get } = setup();
    const result = { tracks: { items: [track] } };
    get.mockResolvedValue(ok(result));
    expect(await api.search(" Artist ")).toBe(result);
    expect(await api.search("Artist")).toBe(result);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid searches without authentication or HTTP", async () => {
    const { api, get } = setup();
    await expect(api.search(" ")).rejects.toThrow("empty");
    await expect(api.search("Artist", NaN)).rejects.toThrow("finite");
    expect(AuthManager.prototype.initialize).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("honours a short Retry-After on metadata requests", async () => {
    vi.useFakeTimers();
    const { api, get } = setup();
    get
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { "retry-after": "1" } })
      .mockResolvedValueOnce(ok(playlist));
    const pending = api.getPlaylist("playlist1", { maxTracks: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject(playlist);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
