import "server-only";

import { EvotorClient } from "./client";
import { evotorEmployeeSchema } from "./types";

export function fetchEvotorEmployees(client: EvotorClient) {
  return client.list("/employees", evotorEmployeeSchema);
}
