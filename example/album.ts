import "dotenv/config";
import { SPApi } from "../src/index.js";

const api = new SPApi();

(async () => {
  const albumId = "0eyy6mYeDddAxpPFOzVtuJ";
  const album = await api.getAlbum(albumId);

  console.log(album);
})();
