export type YooKassaFailureKind =
  | "authentication"
  | "configuration"
  | "network"
  | "provider"
  | "rate_limit"
  | "validation";

export class YooKassaError extends Error {
  readonly kind: YooKassaFailureKind;
  readonly providerCode: string | null;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(params: {
    message: string;
    kind: YooKassaFailureKind;
    providerCode?: string | null;
    retryable?: boolean;
    status?: number | null;
  }) {
    super(params.message);
    this.name = "YooKassaError";
    this.kind = params.kind;
    this.providerCode = params.providerCode ?? null;
    this.retryable = params.retryable ?? false;
    this.status = params.status ?? null;
  }
}

export function safeYooKassaErrorCode(error: unknown) {
  if (error instanceof YooKassaError) {
    return error.providerCode || `YOOKASSA_${error.kind.toUpperCase()}`;
  }
  return "YOOKASSA_UNEXPECTED";
}
