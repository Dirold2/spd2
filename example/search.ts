import "dotenv/config";
import { SPApi } from "../src/index.js";

const api = new SPApi();

(async () => {
  const results = await api.search("Daft Punk");

  console.log(results);
})();
