import "dotenv/config";
import { SPApi } from "../src";

const SP_DC = process.env.SPOTIFY_SP_DC || "";
const api = new SPApi(SP_DC);

(async () => {
  if (!SP_DC) {
    throw new Error("SPOTIFY_SP_DC is missing in .env file");
  }

  await api.initialize();
  // spotify:track:69kOkLUCkxIZYexIgSG8rq
  // https://open.spotify.com/track/10pXYKoJOxNAWkeGkNeNnH?si=b1cbe210503e4b4b
  const trackId = "69kOkLUCkxIZYexIgSG8rq";
  const getAudioUrls = await api.getTrack(trackId);

  console.log(getAudioUrls);
})();
