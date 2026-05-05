import { LRUCache } from "lru-cache";

export const trackCache = new LRUCache<string, any>({
  max: 1000,
  ttl: 1000 * 60 * 5,
  ttlAutopurge: true,
  updateAgeOnGet: true
});
