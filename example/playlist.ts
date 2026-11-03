import "dotenv/config";
import { SPApi } from "../src/index.js";

const api = new SPApi();

(async () => {
  const playlistId = "37i9dQZF1DZ06evO1tdwAV";
  const playlist = await api.getPlaylist(playlistId);

  console.log(playlist);
})();
