export type EvotorFailureContext = {
  source: "api" | "configuration" | "unknown";
  status?: number | null;
  retryable?: boolean;
  code?: string | null;
};

export type EvotorFailureClassification =
  | { kind: "transient"; connectionStatus: "error" }
  | { kind: "auth"; connectionStatus: "revoked" }
  | { kind: "configuration"; connectionStatus: "uninstalled" }
  | { kind: "worker_configuration"; connectionStatus: null };

const RETRY_BASE_SECONDS = 30;
const RETRY_CEILING_SECONDS = 15 * 60;

export function classifyEvotorFailure(
  context: EvotorFailureContext
): EvotorFailureClassification {
  if (context.source === "configuration") {
    if (
      context.code === "TOKEN_ENCRYPTION_KEY_MISSING" ||
      context.code === "TOKEN_ENCRYPTION_KEY_INVALID" ||
      context.code === "TOKEN_PAYLOAD_INVALID" ||
      context.code === "TOKEN_DECRYPTION_FAILED"
    ) {
      return { kind: "worker_configuration", connectionStatus: null };
    }
    return { kind: "configuration", connectionStatus: "uninstalled" };
  }
  if (context.status === 401) {
    return { kind: "auth", connectionStatus: "revoked" };
  }
  if (
    context.source === "unknown" ||
    context.retryable ||
    context.status === 429 ||
    (typeof context.status === "number" && context.status >= 500)
  ) {
    return { kind: "transient", connectionStatus: "error" };
  }
  return { kind: "configuration", connectionStatus: "uninstalled" };
}

export function evotorRetryDelaySeconds(consecutiveFailures: number, jitterUnit = Math.random()) {
  const failure = Math.max(1, Math.floor(consecutiveFailures));
  const exponential = RETRY_BASE_SECONDS * 2 ** Math.min(failure - 1, 10);
  const base = Math.min(RETRY_CEILING_SECONDS, exponential);
  const normalizedJitter = Math.min(1, Math.max(0, jitterUnit));
  const jittered = Math.round(base * (0.8 + normalizedJitter * 0.4));
  return Math.min(RETRY_CEILING_SECONDS, Math.max(15, jittered));
}

export function evotorRecoveryState(status: string) {
  if (status === "connected") return "connected" as const;
  if (status === "error") return "degraded" as const;
  if (status === "revoked") return "auth_error" as const;
  return "disabled" as const;
}
