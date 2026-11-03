import "dotenv/config";
import { SPApi } from "../src/index.js";

const SP_DC = process.env.SPOTIFY_SP_DC || "";
const api = new SPApi(SP_DC);

(async () => {
  if (!SP_DC) {
    throw new Error("SPOTIFY_SP_DC is missing in .env file");
  }

  await api.initialize();
  // spotify:track:69kOkLUCkxIZYexIgSG8rq
  // https://open.spotify.com/track/1VdRB7TUTWuRR7MaaAsiRX?si=25ee82db5e4b4c82
  const trackId = "1VdRB7TUTWuRR7MaaAsiRX";
  const getAudioUrls = await api.getTrack(trackId);

  console.log(getAudioUrls);
})();
