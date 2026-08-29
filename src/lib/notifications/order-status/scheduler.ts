import "server-only";

import { logOperationalEvent } from "@/lib/observability";
import {
  areOrderStatusNotificationsEnabled,
  processOrderNotificationBatch
} from "./service";

type SchedulerState = {
  running: boolean;
  started: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

const schedulerGlobal = globalThis as typeof globalThis & {
  __karimoffOrderNotificationScheduler?: SchedulerState;
};

async function run(state: SchedulerState) {
  if (state.running) return;
  state.running = true;
  try {
    const result = await processOrderNotificationBatch(10);
    if (result.claimed > 0) logOperationalEvent("order_notification.batch", result);
  } finally {
    state.running = false;
  }
}

export function startOrderNotificationScheduler() {
  if (!areOrderStatusNotificationsEnabled()) return;
  if (schedulerGlobal.__karimoffOrderNotificationScheduler?.started) return;
  const state: SchedulerState = { running: false, started: true, timer: null };
  const timer = setInterval(() => void run(state), 10_000);
  timer.unref();
  state.timer = timer;
  schedulerGlobal.__karimoffOrderNotificationScheduler = state;
  const initial = setTimeout(() => void run(state), 3_000);
  initial.unref();
  logOperationalEvent("order_notification.scheduler_started", { interval_seconds: 10 });
}
