import "server-only";

import { YooKassaError } from "./errors";
import type { YooKassaConfiguration } from "./config";
import type {
  CreateYooKassaPaymentInput,
  CreateYooKassaReceiptInput,
  CreateYooKassaRefundInput,
  YooKassaPayment,
  YooKassaProviderReceipt,
  YooKassaRefund
} from "./types";

type FetchLike = typeof fetch;

type YooKassaClientOptions = {
  fetchImpl?: FetchLike;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

type ProviderErrorPayload = {
  code?: unknown;
  type?: unknown;
};

const IDEMPOTENCE_KEY_PATTERN = /^[0-9A-Za-z+_.-]{1,64}$/;
const RETRY_BASE_MS = [500, 1_500, 3_500] as const;

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt: number, random: () => number) {
  const base = RETRY_BASE_MS[Math.min(attempt, RETRY_BASE_MS.length - 1)];
  return Math.round(base * (0.8 + Math.min(1, Math.max(0, random())) * 0.4));
}

async function parseProviderError(response: Response): Promise<ProviderErrorPayload> {
  try {
    const payload = await response.json() as ProviderErrorPayload;
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function providerError(response: Response, payload: ProviderErrorPayload) {
  const status = response.status;
  const providerCode = typeof payload.code === "string" ? payload.code.slice(0, 80) : null;
  if (status === 401) {
    return new YooKassaError({
      message: "YooKassa rejected API credentials.",
      kind: "authentication",
      providerCode: providerCode || "UNAUTHORIZED",
      status
    });
  }
  if (status === 429) {
    return new YooKassaError({
      message: "YooKassa rate limit was exceeded.",
      kind: "rate_limit",
      providerCode: providerCode || "RATE_LIMITED",
      retryable: true,
      status
    });
  }
  return new YooKassaError({
    message: status >= 500 ? "YooKassa is temporarily unavailable." : "YooKassa rejected the request.",
    kind: status >= 500 ? "provider" : "validation",
    providerCode: providerCode || (status >= 500 ? "PROVIDER_UNAVAILABLE" : "REQUEST_REJECTED"),
    retryable: status >= 500,
    status
  });
}

export class YooKassaClient {
  private readonly configuration: YooKassaConfiguration;
  private readonly fetchImpl: FetchLike;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    configuration: YooKassaConfiguration,
    options: YooKassaClientOptions = {}
  ) {
    this.configuration = configuration;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  createPayment(input: CreateYooKassaPaymentInput, idempotenceKey: string) {
    return this.request<YooKassaPayment>("/payments", {
      body: input,
      idempotenceKey,
      method: "POST"
    });
  }

  getPayment(paymentId: string) {
    return this.request<YooKassaPayment>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET"
    });
  }

  createRefund(input: CreateYooKassaRefundInput, idempotenceKey: string) {
    return this.request<YooKassaRefund>("/refunds", {
      body: input,
      idempotenceKey,
      method: "POST"
    });
  }

  getRefund(refundId: string) {
    return this.request<YooKassaRefund>(`/refunds/${encodeURIComponent(refundId)}`, {
      method: "GET"
    });
  }

  createReceipt(input: CreateYooKassaReceiptInput, idempotenceKey: string) {
    return this.request<YooKassaProviderReceipt>("/receipts", {
      body: input,
      idempotenceKey,
      method: "POST"
    });
  }

  getReceipt(receiptId: string) {
    return this.request<YooKassaProviderReceipt>(`/receipts/${encodeURIComponent(receiptId)}`, {
      method: "GET"
    });
  }

  private async request<T>(
    path: string,
    options: { body?: unknown; idempotenceKey?: string; method: "GET" | "POST" }
  ): Promise<T> {
    if (options.method === "POST" && !IDEMPOTENCE_KEY_PATTERN.test(options.idempotenceKey ?? "")) {
      throw new YooKassaError({
        message: "Invalid YooKassa idempotence key.",
        kind: "validation",
        providerCode: "INVALID_IDEMPOTENCE_KEY"
      });
    }

    const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    let lastError: YooKassaError | null = null;

    for (let attempt = 0; attempt < RETRY_BASE_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.configuration.baseUrl}${path}`, {
          method: options.method,
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${Buffer.from(`${this.configuration.shopId}:${this.configuration.secretKey}`).toString("base64")}`,
            ...(serializedBody ? { "Content-Type": "application/json" } : {}),
            ...(options.idempotenceKey ? { "Idempotence-Key": options.idempotenceKey } : {})
          },
          body: serializedBody,
          cache: "no-store",
          signal: controller.signal
        });

        if (response.ok) return await response.json() as T;
        const error = providerError(response, await parseProviderError(response));
        lastError = error;
        if (!error.retryable || attempt === RETRY_BASE_MS.length - 1) throw error;
      } catch (error) {
        if (error instanceof YooKassaError) {
          lastError = error;
          if (!error.retryable || attempt === RETRY_BASE_MS.length - 1) throw error;
        } else {
          lastError = new YooKassaError({
            message: "YooKassa request did not complete.",
            kind: "network",
            providerCode: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
            retryable: true
          });
          if (attempt === RETRY_BASE_MS.length - 1) throw lastError;
        }
      } finally {
        clearTimeout(timeout);
      }

      await this.sleep(retryDelay(attempt, this.random));
    }

    throw lastError ?? new YooKassaError({
      message: "YooKassa request failed.",
      kind: "provider",
      providerCode: "UNKNOWN_PROVIDER_ERROR"
    });
  }
}
