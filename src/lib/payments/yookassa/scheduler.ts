import "server-only";

import { logOperationalEvent } from "@/lib/observability";
import { isYooKassaReconciliationEnabled } from "./config";
import { runYooKassaReconciliationBatch } from "./service";

type SchedulerState = {
  started: boolean;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

const schedulerGlobal = globalThis as typeof globalThis & {
  __karimoffYooKassaScheduler?: SchedulerState;
};

async function run(state: SchedulerState) {
  if (state.running) return;
  state.running = true;
  const startedAt = Date.now();
  try {
    const result = await runYooKassaReconciliationBatch(10);
    logOperationalEvent("yookassa.reconciliation.completed", {
      duration_ms: Date.now() - startedAt,
      fiscal_count: result.fiscal,
      payment_count: result.payments,
      refund_count: result.refunds
    });
  } catch {
    logOperationalEvent("yookassa.reconciliation.failed", {
      duration_ms: Date.now() - startedAt
    });
  } finally {
    state.running = false;
  }
}

export function startYooKassaBackgroundScheduler() {
  if (!isYooKassaReconciliationEnabled()) return;
  if (schedulerGlobal.__karimoffYooKassaScheduler?.started) return;

  const intervalSeconds = 5;
  const state: SchedulerState = {
    started: true,
    running: false,
    timer: null
  };
  const timer = setInterval(() => void run(state), intervalSeconds * 1000);
  timer.unref();
  state.timer = timer;
  schedulerGlobal.__karimoffYooKassaScheduler = state;
  const initial = setTimeout(() => void run(state), 2_000);
  initial.unref();

  logOperationalEvent("yookassa.reconciliation.scheduler_started", {
    interval_seconds: intervalSeconds
  });
}
