import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function runCartStorageFixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-cart-storage-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "cart-checkout-storage.ts"), read("src/lib/cart-checkout-storage.ts"));
  const moduleUrl = pathToFileURL(join(directory, "cart-checkout-storage.ts")).href;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `
      class Storage {
        values = new Map();
        getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
        removeItem(key) { this.values.delete(key); }
        setItem(key, value) { this.values.set(key, String(value)); }
      }
      const events = [];
      globalThis.CustomEvent ??= class CustomEvent {
        constructor(type, options) { this.type = type; this.detail = options?.detail; }
      };
      globalThis.window = {
        localStorage: new Storage(),
        sessionStorage: new Storage(),
        dispatchEvent: (event) => events.push(event.detail)
      };
      const cart = await import(${JSON.stringify(moduleUrl)});
      window.localStorage.setItem(cart.CART_STORAGE_KEY, '[{"id":"a"}]');
      const first = cart.getOrCreateCheckoutRequestId("cart-a");
      const repeated = cart.getOrCreateCheckoutRequestId("cart-a");
      cart.rememberCheckoutPayment({ cartPayload: "cart-a", idempotencyKey: first, paymentId: "11111111-1111-4111-8111-111111111111" });
      const cleared = cart.finishVerifiedCheckoutPayment("11111111-1111-4111-8111-111111111111");
      const removed = window.localStorage.getItem(cart.CART_STORAGE_KEY) === null;

      window.localStorage.setItem(cart.CART_STORAGE_KEY, '[{"id":"b"}]');
      const second = cart.getOrCreateCheckoutRequestId("cart-b");
      cart.rememberCheckoutPayment({ cartPayload: "cart-b", idempotencyKey: second, paymentId: "22222222-2222-4222-8222-222222222222" });
      window.localStorage.setItem(cart.CART_STORAGE_KEY, '[{"id":"new-cart"}]');
      const protectedNewCart = !cart.finishVerifiedCheckoutPayment("22222222-2222-4222-8222-222222222222");
      console.log(JSON.stringify({
        cleared,
        protectedNewCart,
        removed,
        reused: first === repeated,
        differentCartGetsNewKey: first !== second,
        events
      }));
    `
  ], { cwd: root, encoding: "utf8" });
  rmSync(directory, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("verified payment clears only the submitted cart and reuses a checkout idempotency key", () => {
  const result = runCartStorageFixture();
  assert.equal(result.reused, true);
  assert.equal(result.differentCartGetsNewKey, true);
  assert.equal(result.cleared, true);
  assert.equal(result.removed, true);
  assert.equal(result.protectedNewCart, true);
  assert.deepEqual(result.events.map((event) => event.clear), [true, false]);
});

test("payment return clears the cart only after a server-confirmed paid state", () => {
  const paymentReturn = read("src/components/payments/PaymentReturnStatus.tsx");
  const cartProvider = read("src/components/cart/CartProvider.tsx");
  const cartDrawer = read("src/components/cart/CartDrawer.tsx");

  assert.match(paymentReturn, /if \(state !== "paid"\) return undefined;[\s\S]+finishVerifiedCheckoutPayment/);
  assert.match(paymentReturn, /state === "cancelled" \|\| state === "failed"[\s\S]+releaseCheckoutPayment/);
  assert.match(paymentReturn, /href="\/profile\/orders"/);
  assert.match(cartProvider, /karimoff-cart-clear-after-payment/);
  assert.match(cartProvider, /detail\?\.clear === false/);
  assert.match(cartDrawer, /getOrCreateCheckoutRequestId\(cartPayload\)/);
  assert.match(cartDrawer, /rememberCheckoutPayment/);
  assert.doesNotMatch(cartDrawer, /idempotency_key" value=\{crypto\.randomUUID/);
});

test("My Orders is authenticated, live, provider-aware, and uses Moscow business time", () => {
  const route = read("src/app/api/customer/orders/route.ts");
  const component = read("src/components/profile/CustomerOrdersLive.tsx");
  const page = read("src/app/profile/orders/page.tsx");
  const profile = read("src/app/profile/page.tsx");
  const header = read("src/components/Header.tsx");

  assert.match(route, /getCurrentCustomer/);
  assert.match(route, /status: 401/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(component, /timeZone: "Europe\/Moscow"/);
  assert.match(component, /"Ожидает оплаты"/);
  assert.match(component, /"Готов к выдаче"/);
  assert.match(component, /"Выдан"/);
  assert.match(component, /window\.addEventListener\("focus"/);
  assert.match(component, /window\.addEventListener\("pageshow"/);
  assert.match(component, /document\.addEventListener\("visibilitychange"/);
  assert.match(component, /document\.visibilityState === "hidden"/);
  assert.match(page, /redirect\(`\/login\?redirectTo=/);
  assert.match(profile, /Оплаченных заказов/);
  assert.match(profile, /CustomerOrdersLive initialOrders=\{orders\} preview/);
  assert.match(header, /href="\/profile\/orders"/);
});
