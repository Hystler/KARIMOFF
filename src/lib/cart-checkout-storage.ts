const CART_STORAGE_KEY = "karimoff_cart";
const CHECKOUT_ATTEMPT_STORAGE_KEY = "karimoff_checkout_attempt_v1";
const CHECKOUT_ATTEMPT_TTL_MS = 15 * 60_000;

type CheckoutAttempt = {
  cartPayload: string;
  cartSnapshot: string;
  createdAt: number;
  idempotencyKey: string;
  paymentId: string | null;
};

function readAttempt(): CheckoutAttempt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const attempt = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (
      typeof attempt.cartPayload !== "string" ||
      typeof attempt.cartSnapshot !== "string" ||
      typeof attempt.createdAt !== "number" ||
      typeof attempt.idempotencyKey !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(attempt.idempotencyKey) ||
      (attempt.paymentId !== null &&
        (typeof attempt.paymentId !== "string" || !/^[0-9a-f-]{36}$/i.test(attempt.paymentId)))
    ) {
      return null;
    }
    return attempt as CheckoutAttempt;
  } catch {
    return null;
  }
}

function writeAttempt(attempt: CheckoutAttempt) {
  window.sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
}

export function getOrCreateCheckoutRequestId(cartPayload: string) {
  const existing = readAttempt();
  if (
    existing &&
    existing.cartPayload === cartPayload &&
    Date.now() - existing.createdAt < CHECKOUT_ATTEMPT_TTL_MS
  ) {
    return existing.idempotencyKey;
  }

  const idempotencyKey = crypto.randomUUID();
  writeAttempt({
    cartPayload,
    cartSnapshot: window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]",
    createdAt: Date.now(),
    idempotencyKey,
    paymentId: null
  });
  return idempotencyKey;
}

export function rememberCheckoutPayment(params: {
  cartPayload: string;
  idempotencyKey: string;
  paymentId: string;
}) {
  const existing = readAttempt();
  writeAttempt({
    cartPayload: params.cartPayload,
    cartSnapshot: window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]",
    createdAt: existing?.createdAt ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    paymentId: params.paymentId
  });
}

export function finishVerifiedCheckoutPayment(paymentId: string) {
  if (typeof window === "undefined") return false;
  const attempt = readAttempt();
  if (!attempt || attempt.paymentId !== paymentId) return false;

  const currentCart = window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]";
  const shouldClear = currentCart === attempt.cartSnapshot;
  if (shouldClear) window.localStorage.removeItem(CART_STORAGE_KEY);
  window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("karimoff-cart-clear-after-payment", {
    detail: { clear: shouldClear, paymentId }
  }));
  return shouldClear;
}

export function releaseCheckoutPayment(paymentId: string) {
  if (typeof window === "undefined") return;
  const attempt = readAttempt();
  if (attempt?.paymentId === paymentId) {
    window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  }
}

export { CART_STORAGE_KEY };
