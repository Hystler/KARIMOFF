import "server-only";

import { isYooKassaCheckoutEnabled } from "./yookassa/config";

export const PAYMENT_PROVIDER = "yookassa" as const;

export function isRealPaymentsEnabled() {
  return isYooKassaCheckoutEnabled();
}

export function getPaymentProvider() {
  if (!isRealPaymentsEnabled()) {
    throw new Error("Online payments are disabled.");
  }
  return PAYMENT_PROVIDER;
}
