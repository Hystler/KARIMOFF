import "server-only";

import { EvotorClient } from "./client";
import { evotorStoreSchema } from "./types";

export function fetchEvotorStores(client: EvotorClient) {
  return client.list("/stores", evotorStoreSchema);
}
