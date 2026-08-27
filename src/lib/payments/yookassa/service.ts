import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { logOperationalError, logOperationalEvent } from "@/lib/observability";
import { YooKassaClient } from "./client";
import {
  isYooKassaCheckoutEnabled,
  isYooKassaReconciliationEnabled,
  requireYooKassaConfiguration,
  type YooKassaConfiguration
} from "./config";
import { safeYooKassaErrorCode, YooKassaError } from "./errors";
import { moneyToMinorUnits, rubles } from "./money";
import {
  applyYooKassaPaymentState,
  applyYooKassaRefundState,
  bindFiscalReceiptRequestFingerprint,
  bindPaymentRequestFingerprint,
  bindRefundRequestFingerprint,
  claimDueFiscalReceipts,
  claimDueYooKassaRefunds,
  claimDueYooKassaPayments,
  createYooKassaRefundAttempt,
  findInternalPaymentId,
  findInternalRefundId,
  finishPaymentEvent,
  getFiscalReceiptContext,
  getYooKassaPaymentContext,
  getYooKassaRefundContext,
  insertPaymentEvent,
  markFiscalReceiptFailure,
  markYooKassaPaymentFailure,
  markYooKassaRefundFailure,
  recordFiscalReceiptState,
  recordYooKassaPaymentCreated,
  type YooKassaPaymentContext,
  type YooKassaRefundAllocation,
  type YooKassaRefundContext
} from "./repository";
import {
  buildPartialRefundReceipt,
  buildPaymentReceipt,
  buildPrepaymentSettlementReceipt
} from "./receipt";
import type {
  CreateYooKassaPaymentInput,
  YooKassaPayment,
  YooKassaRefund
} from "./types";

export const YOOKASSA_WEBHOOK_EVENTS = [
  "payment.waiting_for_capture",
  "payment.succeeded",
  "payment.canceled",
  "refund.succeeded"
] as const;

export type YooKassaWebhookEvent = typeof YOOKASSA_WEBHOOK_EVENTS[number];

type ClientFactory = (configuration: YooKassaConfiguration) => YooKassaClient;

function defaultClientFactory(configuration: YooKassaConfiguration) {
  return new YooKassaClient(configuration);
}

function assertPaymentExecutionEnabled() {
  if (!isYooKassaCheckoutEnabled()) {
    throw new YooKassaError({
      message: "YooKassa payments are disabled.",
      kind: "configuration",
      providerCode: "PAYMENTS_DISABLED"
    });
  }
}

function assertProviderRuntimeConfigured() {
  if (!isYooKassaReconciliationEnabled()) {
    throw new YooKassaError({
      message: "YooKassa reconciliation is unavailable.",
      kind: "configuration",
      providerCode: "CONFIGURATION_INCOMPLETE"
    });
  }
}

function safeConfirmationUrl(value: string | undefined) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function paymentReturnUrl(configuration: YooKassaConfiguration, paymentId: string) {
  const url = new URL(configuration.returnUrl);
  url.searchParams.set("payment", paymentId);
  return url.toString();
}

function paymentDescription(displayNumber: string) {
  return `Заказ KARIMOFF ${displayNumber}`.slice(0, 128);
}

function paymentRequest(
  configuration: YooKassaConfiguration,
  context: YooKassaPaymentContext
): CreateYooKassaPaymentInput {
  const origin = new URL(configuration.returnUrl).hostname;
  return {
    amount: rubles(context.amount),
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: paymentReturnUrl(configuration, context.id)
    },
    description: paymentDescription(context.displayNumber),
    metadata: {
      environment: origin,
      order_id: context.orderId,
      order_number: context.displayNumber,
      payment_id: context.id,
      source: "karimoff_web"
    },
    receipt: buildPaymentReceipt({
      email: context.receiptEmail,
      expectedTotal: context.amount,
      items: context.items
    })
  };
}

function requestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertPaymentBinding(context: YooKassaPaymentContext, payment: YooKassaPayment) {
  if (
    payment.amount.currency !== "RUB" ||
    moneyToMinorUnits(payment.amount.value) !== moneyToMinorUnits(context.amount)
  ) {
    throw new YooKassaError({
      message: "YooKassa payment amount does not match the order.",
      kind: "validation",
      providerCode: "PAYMENT_AMOUNT_MISMATCH"
    });
  }
  if (
    payment.metadata?.order_id !== context.orderId ||
    payment.metadata?.payment_id !== context.id
  ) {
    throw new YooKassaError({
      message: "YooKassa payment metadata does not match the order.",
      kind: "validation",
      providerCode: "PAYMENT_METADATA_MISMATCH"
    });
  }
  if (context.providerPaymentId && context.providerPaymentId !== payment.id) {
    throw new YooKassaError({
      message: "YooKassa payment identifier does not match.",
      kind: "validation",
      providerCode: "PAYMENT_ID_MISMATCH"
    });
  }
}

export async function createYooKassaPaymentForOrder(
  paymentId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  assertPaymentExecutionEnabled();
  return executeYooKassaPaymentForOrder(paymentId, clientFactory);
}

async function executeYooKassaPaymentForOrder(
  paymentId: string,
  clientFactory: ClientFactory
) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const context = await getYooKassaPaymentContext(paymentId);
  if (!context) throw new Error("YOOKASSA_PAYMENT_NOT_FOUND");

  if (["paid", "refunded", "partially_refunded"].includes(context.status)) {
    return {
      confirmationUrl: paymentReturnUrl(configuration, context.id),
      orderId: context.orderId,
      paymentId: context.id,
      status: context.status
    };
  }

  const body = paymentRequest(configuration, context);
  await bindPaymentRequestFingerprint(context.id, requestFingerprint(body));
  const client = clientFactory(configuration);

  try {
    const payment = context.providerPaymentId
      ? await client.getPayment(context.providerPaymentId)
      : await client.createPayment(body, context.idempotencyKey);
    assertPaymentBinding(context, payment);
    await recordYooKassaPaymentCreated(context.id, payment);
    await applyYooKassaPaymentState(context.id, payment);

    const confirmationUrl = safeConfirmationUrl(payment.confirmation?.confirmation_url)
      ?? (payment.status === "succeeded" ? paymentReturnUrl(configuration, context.id) : null);
    if (!confirmationUrl) {
      throw new YooKassaError({
        message: "YooKassa did not return a safe confirmation URL.",
        kind: "provider",
        providerCode: "CONFIRMATION_URL_MISSING",
        retryable: payment.status === "pending"
      });
    }

    logOperationalEvent("yookassa.payment.created", {
      order_id: context.orderId,
      payment_id: context.id,
      provider_status: payment.status,
      test: Boolean(payment.test)
    });
    return {
      confirmationUrl,
      orderId: context.orderId,
      paymentId: context.id,
      status: payment.status
    };
  } catch (error) {
    const retryable = error instanceof YooKassaError ? error.retryable : true;
    await markYooKassaPaymentFailure({
      errorCode: safeYooKassaErrorCode(error),
      paymentId: context.id,
      retryable
    });
    logOperationalError("yookassa.payment.create_failed", {
      error_code: safeYooKassaErrorCode(error),
      order_id: context.orderId,
      payment_id: context.id,
      retryable
    });
    throw error;
  }
}

export async function reconcileYooKassaPayment(
  paymentId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const context = await getYooKassaPaymentContext(paymentId);
  if (
    !context ||
    (context.status !== "pending" && context.receiptRegistration !== "pending")
  ) return { skipped: true };

  try {
    if (!context.providerPaymentId) {
      // This is recovery of an already persisted attempt. It must reuse the
      // original operation key even if new checkouts were disabled meanwhile.
      return await executeYooKassaPaymentForOrder(context.id, clientFactory);
    }
    const payment = await clientFactory(configuration).getPayment(context.providerPaymentId);
    assertPaymentBinding(context, payment);
    await applyYooKassaPaymentState(context.id, payment);
    return { skipped: false, status: payment.status };
  } catch (error) {
    const retryable = error instanceof YooKassaError ? error.retryable : true;
    await markYooKassaPaymentFailure({
      errorCode: safeYooKassaErrorCode(error),
      paymentId: context.id,
      retryable
    });
    throw error;
  }
}

export async function checkYooKassaPaymentStatusReadOnly(
  paymentId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const context = await getYooKassaPaymentContext(paymentId);
  if (!context) throw new Error("YOOKASSA_PAYMENT_NOT_FOUND");
  if (!context.providerPaymentId) {
    throw new YooKassaError({
      message: "YooKassa payment has not returned a provider identifier yet.",
      kind: "validation",
      providerCode: "PROVIDER_PAYMENT_ID_MISSING"
    });
  }

  const payment = await clientFactory(configuration).getPayment(context.providerPaymentId);
  assertPaymentBinding(context, payment);
  await applyYooKassaPaymentState(context.id, payment);
  return { paymentId: context.id, status: payment.status };
}

export async function reconcileYooKassaFiscalReceipt(
  receiptId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const context = await getFiscalReceiptContext(receiptId);
  if (!context) return { skipped: true };
  const client = clientFactory(configuration);

  try {
    let receipt;
    if (context.providerReceiptId) {
      receipt = await client.getReceipt(context.providerReceiptId);
    } else {
      const body = buildPrepaymentSettlementReceipt({
        email: context.receiptEmail,
        expectedTotal: context.amount,
        items: context.items,
        paymentId: context.providerPaymentId
      });
      await bindFiscalReceiptRequestFingerprint(context.id, requestFingerprint(body));
      receipt = await client.createReceipt(body, context.idempotencyKey);
    }
    if (receipt.payment_id && receipt.payment_id !== context.providerPaymentId) {
      throw new YooKassaError({
        message: "YooKassa receipt payment does not match.",
        kind: "validation",
        providerCode: "RECEIPT_PAYMENT_MISMATCH"
      });
    }
    await recordFiscalReceiptState(context.id, receipt);
    logOperationalEvent("yookassa.receipt.reconciled", {
      order_id: context.orderId,
      receipt_id: context.id,
      provider_status: receipt.status
    });
    return { skipped: false, status: receipt.status };
  } catch (error) {
    await markFiscalReceiptFailure(context.id, safeYooKassaErrorCode(error));
    throw error;
  }
}

function assertRefundBinding(context: YooKassaRefundContext, refund: YooKassaRefund) {
  if (
    refund.payment_id !== context.providerPaymentId ||
    refund.amount.currency !== "RUB" ||
    moneyToMinorUnits(refund.amount.value) !== moneyToMinorUnits(context.amount)
  ) {
    throw new YooKassaError({
      message: "YooKassa refund does not match the KARIMOFF refund attempt.",
      kind: "validation",
      providerCode: "REFUND_BINDING_MISMATCH"
    });
  }
  if (context.providerRefundId && context.providerRefundId !== refund.id) {
    throw new YooKassaError({
      message: "YooKassa refund identifier does not match.",
      kind: "validation",
      providerCode: "REFUND_ID_MISMATCH"
    });
  }
}

function refundRequest(context: YooKassaRefundContext) {
  return {
    amount: rubles(context.amount),
    payment_id: context.providerPaymentId,
    description: `Возврат по заказу KARIMOFF ${context.orderId.slice(0, 8)}`.slice(0, 128),
    ...(!context.isFullRefund
      ? {
          receipt: buildPartialRefundReceipt({
            email: context.receiptEmail,
            expectedTotal: context.amount,
            handedOut: context.handedOut,
            items: context.items
          })
        }
      : {})
  };
}

async function executeYooKassaRefund(
  refundId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const context = await getYooKassaRefundContext(refundId);
  if (!context) throw new Error("YOOKASSA_REFUND_NOT_FOUND");
  if (
    context.status !== "pending" &&
    context.receiptRegistration !== "pending"
  ) return { refundId: context.id, skipped: true, status: context.status };

  const body = refundRequest(context);
  await bindRefundRequestFingerprint(context.id, requestFingerprint(body));
  try {
    const client = clientFactory(configuration);
    const refund = context.providerRefundId
      ? await client.getRefund(context.providerRefundId)
      : await client.createRefund(body, context.idempotencyKey);
    assertRefundBinding(context, refund);
    await applyYooKassaRefundState(context.id, refund);
    logOperationalEvent("yookassa.refund.reconciled", {
      order_id: context.orderId,
      refund_id: context.id,
      provider_status: refund.status
    });
    return { refundId: context.id, skipped: false, status: refund.status };
  } catch (error) {
    await markYooKassaRefundFailure({
      errorCode: safeYooKassaErrorCode(error),
      refundId: context.id,
      retryable: error instanceof YooKassaError ? error.retryable : true
    });
    throw error;
  }
}

export async function createYooKassaRefund(params: {
  allocations?: YooKassaRefundAllocation[];
  amount: string;
  createdByStaffId: string;
  idempotencyKey: string;
  paymentId: string;
  reason: string;
}, clientFactory: ClientFactory = defaultClientFactory) {
  assertPaymentExecutionEnabled();
  const refundId = await createYooKassaRefundAttempt(params);
  return executeYooKassaRefund(refundId, clientFactory);
}

export function reconcileYooKassaRefund(
  refundId: string,
  clientFactory: ClientFactory = defaultClientFactory
) {
  return executeYooKassaRefund(refundId, clientFactory);
}

export async function runYooKassaReconciliationBatch(limit = 10) {
  if (!isYooKassaReconciliationEnabled()) return { fiscal: 0, payments: 0, refunds: 0 };
  const workerId = randomUUID();
  const paymentIds = await claimDueYooKassaPayments(workerId, limit);
  let payments = 0;
  for (const paymentId of paymentIds) {
    try {
      await reconcileYooKassaPayment(paymentId);
      payments += 1;
    } catch {
      // The payment row contains the retry schedule and safe failure code.
    }
  }

  const refundIds = await claimDueYooKassaRefunds(workerId, limit);
  let refunds = 0;
  for (const refundId of refundIds) {
    try {
      await reconcileYooKassaRefund(refundId);
      refunds += 1;
    } catch {
      // The refund row contains the retry schedule and safe failure code.
    }
  }

  const receiptIds = await claimDueFiscalReceipts(workerId, limit);
  let fiscal = 0;
  for (const receiptId of receiptIds) {
    try {
      await reconcileYooKassaFiscalReceipt(receiptId);
      fiscal += 1;
    } catch {
      // The fiscal receipt row contains the retry schedule and safe failure code.
    }
  }
  return { fiscal, payments, refunds };
}

export async function processYooKassaWebhook(params: {
  event: YooKassaWebhookEvent;
  objectId: string;
}, clientFactory: ClientFactory = defaultClientFactory) {
  assertProviderRuntimeConfigured();
  const configuration = requireYooKassaConfiguration();
  const eventId = `${params.event}:${params.objectId}`;
  const eventRow = await insertPaymentEvent({
    eventId,
    eventType: params.event,
    objectId: params.objectId,
    paymentId: null
  });
  if (eventRow?.processed_at) return { duplicate: true };

  try {
    const client = clientFactory(configuration);
    if (params.event.startsWith("payment.")) {
      const payment = await client.getPayment(params.objectId);
      const paymentId = await findInternalPaymentId(payment);
      if (!paymentId) {
        await finishPaymentEvent(eventId, {
          errorCode: "UNKNOWN_PAYMENT",
          processed: true,
          verified: true
        });
        return { ignored: true };
      }
      const context = await getYooKassaPaymentContext(paymentId);
      if (!context) throw new Error("YOOKASSA_PAYMENT_NOT_FOUND");
      assertPaymentBinding(context, payment);
      await applyYooKassaPaymentState(paymentId, payment);
      await finishPaymentEvent(eventId, { paymentId, verified: true });
      return { duplicate: false, paymentId };
    }

    const refund = await client.getRefund(params.objectId);
    const refundId = await findInternalRefundId(refund);
    if (!refundId) {
      await finishPaymentEvent(eventId, {
        errorCode: "UNKNOWN_REFUND",
        processed: true,
        verified: true
      });
      return { ignored: true };
    }
    const context = await getYooKassaRefundContext(refundId);
    if (!context) throw new Error("YOOKASSA_REFUND_NOT_FOUND");
    assertRefundBinding(context, refund);
    await applyYooKassaRefundState(refundId, refund);
    await finishPaymentEvent(eventId, { verified: true });
    return { duplicate: false, refundId };
  } catch (error) {
    const permanentlyRejected =
      error instanceof YooKassaError && error.kind === "validation" && !error.retryable;
    await finishPaymentEvent(eventId, {
      errorCode: safeYooKassaErrorCode(error),
      processed: permanentlyRejected,
      verified: false
    });
    throw error;
  }
}

export function isSupportedYooKassaWebhookEvent(value: string): value is YooKassaWebhookEvent {
  return (YOOKASSA_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export function isYooKassaProviderObject(value: unknown): value is YooKassaPayment | YooKassaRefund {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}
