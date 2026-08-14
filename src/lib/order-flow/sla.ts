import type { KitchenSla } from "./types";

export type SlaTone = "normal" | "warning" | "critical";

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

export function formatElapsed(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
