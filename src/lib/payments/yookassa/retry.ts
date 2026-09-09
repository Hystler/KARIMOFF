import { YooKassaError } from "./errors";

export function yooKassaCreationDeadline(createdAt: string) {
  // The persisted attempt predates its first POST. Leave room for an in-flight request.
  return new Date(createdAt).getTime() + 24 * 60 * 60_000 - 60_000;
}

export function assertYooKassaCreationWindow(deadline: number) {
  if (!Number.isFinite(deadline) || Date.now() >= deadline) {
    throw new YooKassaError({
      message: "YooKassa creation requires manual reconciliation after the idempotence window.",
      kind: "validation",
      providerCode: "IDEMPOTENCE_WINDOW_EXPIRED"
    });
  }
}

export function yooKassaReconciliationDelaySeconds(params: {
  ageSeconds: number;
  attempts: number;
  random?: number;
  transientFailure?: boolean;
}) {
  const age = Math.max(0, params.ageSeconds);
  if (age >= 24 * 60 * 60) return null;

  const schedule = age < 120 ? 10 : age < 600 ? 30 : age < 3_600 ? 120 : 900;
  if (!params.transientFailure) return schedule;

  const exponential = Math.min(900, 10 * 2 ** Math.min(7, Math.max(0, params.attempts - 1)));
  const jitter = 0.8 + Math.min(1, Math.max(0, params.random ?? 0.5)) * 0.4;
  return Math.max(schedule, Math.min(900, Math.round(exponential * jitter)));
}
