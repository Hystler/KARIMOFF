import type { KitchenSla } from "./types";

export type SlaTone = "normal" | "warning" | "critical";

export const MAX_OPERATIONAL_ORDER_AGE_SECONDS = 24 * 60 * 60;

export function elapsedSeconds(createdAt: string | Date, now: string | Date | number = Date.now()) {
  const start = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const end = typeof now === "number" ? now : now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function classifySla(seconds: number, sla: KitchenSla): SlaTone {
  if (seconds >= sla.criticalSeconds) return "critical";
  if (seconds >= sla.warningSeconds) return "warning";
  return "normal";
}

export function operationalElapsedSeconds(
  operationalStartedAt: string | Date | null,
  now: string | Date | number = Date.now()
) {
  if (!operationalStartedAt) return null;
  const seconds = elapsedSeconds(operationalStartedAt, now);
  const start = operationalStartedAt instanceof Date
    ? operationalStartedAt.getTime()
    : new Date(operationalStartedAt).getTime();
  const end = typeof now === "number" ? now : now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || start > end + 60_000 || seconds > MAX_OPERATIONAL_ORDER_AGE_SECONDS) {
    return null;
  }
  return seconds;
}

export function formatElapsed(seconds: number) {
  const safeSeconds = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
