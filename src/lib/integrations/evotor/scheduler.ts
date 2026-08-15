import "server-only";

import { logOperationalEvent } from "@/lib/observability";
import { queueDueEvotorSyncs } from "./repository";
import { processPendingEvotorSyncEvents } from "./sync";

type SyncMode = "incremental" | "reconciliation";

type SchedulerState = {
  started: boolean;
  running: boolean;
  pendingModes: Set<SyncMode>;
  timers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>;
};

const globalScheduler = globalThis as typeof globalThis & {
  __karimoffEvotorScheduler?: SchedulerState;
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function runSync(mode: SyncMode) {
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
  }
}

async function drainScheduledSyncs(state: SchedulerState) {
  if (state.running) return;
  state.running = true;
  try {
    while (state.pendingModes.size) {
      // A rolling reconciliation must not be starved by the more frequent incremental timer.
      const mode: SyncMode = state.pendingModes.has("reconciliation")
        ? "reconciliation"
        : "incremental";
      state.pendingModes.delete(mode);
      await runSync(mode);
    }
  } finally {
    state.running = false;
  }
}

function scheduleSync(mode: SyncMode, state: SchedulerState) {
  state.pendingModes.add(mode);
  void drainScheduledSyncs(state);
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
  const state: SchedulerState = {
    started: true,
    running: false,
    pendingModes: new Set<SyncMode>(),
    timers: []
  };
  globalScheduler.__karimoffEvotorScheduler = state;

  const initial = setTimeout(() => scheduleSync("incremental", state), 10_000);
  const incremental = setInterval(
    () => scheduleSync("incremental", state),
    incrementalSeconds * 1000
  );
  const reconciliation = setInterval(
    () => scheduleSync("reconciliation", state),
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
