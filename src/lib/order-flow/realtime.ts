import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";

type Listener = () => void;

const listeners = new Set<Listener>();
let listenRequest: Promise<unknown> | null = null;

async function ensureOrderEventListener() {
  if (!listenRequest) {
    listenRequest = getPostgresSql()
      .listen("karimoff_order_events", () => {
        for (const listener of listeners) listener();
      })
      .catch((error) => {
        listenRequest = null;
        throw error;
      });
  }
  await listenRequest;
}

export async function listenOrderOutboxNotifications(listener: Listener) {
  listeners.add(listener);
  try {
    await ensureOrderEventListener();
  } catch {
    // The SSE route retains a recovery query when LISTEN is temporarily unavailable.
  }
  return () => listeners.delete(listener);
}
