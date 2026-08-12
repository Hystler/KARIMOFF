import "server-only";

import { EvotorClient } from "./client";
import { evotorDocumentSchema } from "./types";

export function fetchEvotorDocuments(client: EvotorClient, params: {
  storeId: string;
  since: Date;
  until: Date;
}) {
  return client.list(`/stores/${encodeURIComponent(params.storeId)}/documents`, evotorDocumentSchema, {
    since: params.since.getTime(),
    until: params.until.getTime()
  });
}
