import "server-only";

export type PaymentCreateInput = {
  amount: number;
  currency: "RUB";
  idempotencyKey: string;
  orderId: string;
  returnUrl: string;
};

export type PaymentCreateResult = {
  confirmationUrl: string;
  providerPaymentId: string;
  status: "pending" | "paid";
};

export type PaymentVerificationResult = {
  amount: number;
  providerPaymentId: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
};

export type RefundInput = {
  amount: number;
  idempotencyKey: string;
  paymentId: string;
  reason?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: PaymentCreateInput): Promise<PaymentCreateResult>;
  verifyPayment(providerPaymentId: string): Promise<PaymentVerificationResult>;
  verifyWebhook(request: Request): Promise<{ eventId: string; payload: unknown }>;
  refund(input: RefundInput): Promise<{ providerRefundId: string; status: "pending" | "completed" }>;
}

export function isRealPaymentsEnabled() {
  return process.env.PAYMENTS_ENABLED === "true" && process.env.NODE_ENV === "production";
}

export function getPaymentProvider(): PaymentProvider {
  if (!isRealPaymentsEnabled()) {
    throw new Error("Online payments are disabled.");
  }

  throw new Error("Payment provider is not configured.");
}
