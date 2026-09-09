import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/cart-checkout-storage.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const cart = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const paymentId = "11111111-1111-4111-8111-111111111111";
class Storage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
function fixture() {
  globalThis.window = { localStorage: new Storage(), sessionStorage: new Storage(), dispatchEvent() {} };
  window.localStorage.setItem(cart.CART_STORAGE_KEY, '[{"product":"original"}]');
  return cart.getOrCreateCheckoutRequestId("original");
}
test("unresolved checkout survives more than fifteen minutes, including a lost create response", () => {
  for (const knownPayment of [false, true]) {
    const key = fixture();
    if (knownPayment) cart.rememberCheckoutPayment({ cartPayload: "original", idempotencyKey: key, paymentId });
    const now = Date.now;
    try {
      Date.now = () => now() + 48 * 60 * 60_000;
      assert.equal(cart.getOrCreateCheckoutRequestId("original"), key);
    } finally { Date.now = now; }
  }
});
test("a cart modified while payment creation is in flight is not erased by the old payment", () => {
  const key = fixture();
  window.localStorage.setItem(cart.CART_STORAGE_KEY, '[{"product":"changed-in-flight"}]');
  cart.rememberCheckoutPayment({ cartPayload: "changed-in-flight", idempotencyKey: key, paymentId });
  assert.equal(cart.finishVerifiedCheckoutPayment(paymentId), false);
  assert.match(window.localStorage.getItem(cart.CART_STORAGE_KEY), /changed-in-flight/);
});
test("lost attempt storage cannot authorize cart deletion", () => {
  const key = fixture();
  window.sessionStorage = new Storage();
  cart.rememberCheckoutPayment({ cartPayload: "original", idempotencyKey: key, paymentId });
  assert.equal(cart.finishVerifiedCheckoutPayment(paymentId), false);
  assert.ok(window.localStorage.getItem(cart.CART_STORAGE_KEY));
});
test("verified cancellation releases an attempt, but another payment cannot clear it", () => {
  const key = fixture();
  cart.rememberCheckoutPayment({ cartPayload: "original", idempotencyKey: key, paymentId });
  cart.releaseCheckoutPayment("22222222-2222-4222-8222-222222222222");
  assert.equal(cart.getOrCreateCheckoutRequestId("original"), key);
  cart.releaseCheckoutPayment(paymentId);
  assert.notEqual(cart.getOrCreateCheckoutRequestId("original"), key);
});
