import "dotenv/config";
import { SPApi } from "../src/SPApi.js";

const SP_DC = process.env.SPOTIFY_SP_DC || "";
const api = new SPApi(SP_DC);

(async () => {
  if (!SP_DC) {
    throw new Error("SPOTIFY_SP_DC is missing in .env file");
  }

  await api.initialize();

  const trackId = "7yMiX7n9SBvadzox8T5jzT";
  const track = await api.getPlaybackInfo(trackId);
  const getAudioUrls = await api.getAudioUrls(trackId);

  console.log(track);
  console.log(getAudioUrls);
})();
