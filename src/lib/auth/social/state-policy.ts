import { timingSafeEqual } from "node:crypto";

type SocialProvider = "telegram" | "vk";

class OAuthStateError extends Error {
  readonly stage = "state" as const;
  readonly code: "browser_binding_mismatch" | "expired_state" | "missing_state" | "state_invalid" | "state_not_found" | "state_replay";

  constructor(code: OAuthStateError["code"]) {
    super(code);
    this.name = "OAuthStateError";
    this.code = code;
  }
}

export type OAuthBrowserBinding = "matched" | "missing";

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateOAuthBrowserBinding(params: {
  provider: SocialProvider;
  cookieState: string | null;
  returnedState: string;
}): OAuthBrowserBinding {
  if (!params.returnedState) {
    throw new OAuthStateError("missing_state");
  }
  if (!params.cookieState) {
    if (params.provider === "telegram") return "missing";
    throw new OAuthStateError("browser_binding_mismatch");
  }
  if (!equalSecret(params.cookieState, params.returnedState)) {
    throw new OAuthStateError("browser_binding_mismatch");
  }
  return "matched";
}

export function classifyOAuthAttemptFailure(params: {
  exists: boolean;
  consumedAt: string | null;
  expiresAt: string | null;
  nowMs?: number;
}) {
  if (!params.exists) return new OAuthStateError("state_not_found");
  if (params.consumedAt) return new OAuthStateError("state_replay");
  if (!params.expiresAt || new Date(params.expiresAt).getTime() <= (params.nowMs ?? Date.now())) {
    return new OAuthStateError("expired_state");
  }
  return new OAuthStateError("state_invalid");
}
