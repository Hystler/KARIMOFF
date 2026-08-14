import "server-only";

import { logOperationalEvent } from "@/lib/observability";
import { queueDueEvotorSyncs } from "./repository";
import { processPendingEvotorSyncEvents } from "./sync";

type SchedulerState = {
  started: boolean;
  running: boolean;
  timers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>;
};

const globalScheduler = globalThis as typeof globalThis & {
  __karimoffEvotorScheduler?: SchedulerState;
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function runSync(mode: "incremental" | "reconciliation", state: SchedulerState) {
  if (state.running) return;
  state.running = true;
  try {
    const queued = await queueDueEvotorSyncs({
      syncType: mode,
      requestedBy: "app-background-worker"
    });
    const processed = await processPendingEvotorSyncEvents(5);
    logOperationalEvent("evotor.background_sync", {
      mode,
      queued: queued.length,
      processed: processed.length
    });
  } catch {
    logOperationalEvent("evotor.background_sync_failed", { mode });
  } finally {
    state.running = false;
  }
}

export function startEvotorBackgroundScheduler() {
  if (
    process.env.EVOTOR_ENABLED !== "true" ||
    process.env.EVOTOR_BACKGROUND_SYNC !== "true"
  ) return;

  const existing = globalScheduler.__karimoffEvotorScheduler;
  if (existing?.started) return;

  const incrementalSeconds = boundedInteger(
    process.env.EVOTOR_INCREMENTAL_INTERVAL_SECONDS,
    120,
    60,
    900
  );
  const reconciliationHours = boundedInteger(
    process.env.EVOTOR_RECONCILIATION_INTERVAL_HOURS,
    6,
    1,
    24
  );
  const state: SchedulerState = { started: true, running: false, timers: [] };
  globalScheduler.__karimoffEvotorScheduler = state;

  const initial = setTimeout(() => void runSync("incremental", state), 10_000);
  const incremental = setInterval(
    () => void runSync("incremental", state),
    incrementalSeconds * 1000
  );
  const reconciliation = setInterval(
    () => void runSync("reconciliation", state),
    reconciliationHours * 60 * 60 * 1000
  );
  initial.unref();
  incremental.unref();
  reconciliation.unref();
  state.timers.push(initial, incremental, reconciliation);

  logOperationalEvent("evotor.background_scheduler_started", {
    incremental_seconds: incrementalSeconds,
    reconciliation_hours: reconciliationHours
  });
}
