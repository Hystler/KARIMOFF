import "server-only";

import { EvotorClient } from "./client";
import { evotorProductSchema } from "./types";

export function fetchEvotorProducts(client: EvotorClient, storeId: string) {
  return client.list(`/stores/${encodeURIComponent(storeId)}/products`, evotorProductSchema);
}
