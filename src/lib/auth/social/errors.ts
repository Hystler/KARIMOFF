export type SocialAuthStage =
  | "start"
  | "callback"
  | "state"
  | "token_exchange"
  | "jwks"
  | "id_token"
  | "identity"
  | "session"
  | "redirect";

export type SocialAuthErrorCode =
  | "browser_binding_mismatch"
  | "expired_state"
  | "identity_conflict"
  | "identity_failed"
  | "id_token_audience"
  | "id_token_expired"
  | "id_token_future_iat"
  | "id_token_issuer"
  | "id_token_malformed"
  | "id_token_nonce"
  | "id_token_signature"
  | "id_token_signing_key"
  | "jwks_invalid"
  | "jwks_unavailable"
  | "missing_code"
  | "missing_state"
  | "provider_cancelled"
  | "session_failed"
  | "state_invalid"
  | "state_not_found"
  | "state_replay"
  | "token_rejected"
  | "token_response_invalid"
  | "token_unavailable"
  | "unknown";

export class SocialAuthError extends Error {
  readonly code: SocialAuthErrorCode;
  readonly stage: SocialAuthStage;
  readonly httpStatus: number | null;
  readonly providerError: string | null;
  readonly networkError: string | null;

  constructor(params: {
    code: SocialAuthErrorCode;
    stage: SocialAuthStage;
    message?: string;
    httpStatus?: number | null;
    providerError?: string | null;
    networkError?: string | null;
    cause?: unknown;
  }) {
    super(params.message ?? params.code, { cause: params.cause });
    this.name = "SocialAuthError";
    this.code = params.code;
    this.stage = params.stage;
    this.httpStatus = params.httpStatus ?? null;
    this.providerError = sanitizeProviderError(params.providerError);
    this.networkError = sanitizeNetworkError(params.networkError);
  }
}

function sanitizeProviderError(value: string | null | undefined) {
  if (!value) return null;
  return /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : "provider_error";
}

function sanitizeNetworkError(value: string | null | undefined) {
  if (!value) return null;
  return /^[A-Z0-9_]{1,64}$/.test(value) ? value : "NETWORK_ERROR";
}

export function getSocialAuthError(error: unknown, fallbackStage: SocialAuthStage = "callback") {
  if (error instanceof SocialAuthError) return error;
  const candidate = error as {
    code?: SocialAuthErrorCode;
    stage?: SocialAuthStage;
    httpStatus?: number | null;
    providerError?: string | null;
    networkError?: string | null;
  };
  if (typeof candidate?.code === "string" && typeof candidate?.stage === "string") {
    return new SocialAuthError({
      code: candidate.code,
      stage: candidate.stage,
      httpStatus: candidate.httpStatus,
      providerError: candidate.providerError,
      networkError: candidate.networkError,
      cause: error
    });
  }
  return new SocialAuthError({ code: "unknown", stage: fallbackStage, cause: error });
}

export function getSocialResultReason(error: SocialAuthError) {
  if (error.code === "provider_cancelled") return "cancelled";
  if (error.code === "expired_state" || error.code === "state_not_found" || error.code === "state_replay") return "expired";
  if (error.code === "identity_conflict") return "link_conflict";
  if (
    error.code === "identity_failed" ||
    error.code === "jwks_invalid" ||
    error.code === "jwks_unavailable" ||
    error.code === "session_failed" ||
    error.code === "token_response_invalid" ||
    error.code === "token_unavailable" ||
    error.code === "unknown"
  ) {
    return "technical";
  }
  return "validation_failed";
}
