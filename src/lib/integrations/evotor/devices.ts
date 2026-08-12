import "server-only";

import { EvotorClient } from "./client";
import { evotorDeviceSchema } from "./types";

export function fetchEvotorDevices(client: EvotorClient) {
  return client.list("/devices", evotorDeviceSchema);
}
