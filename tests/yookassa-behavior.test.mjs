import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const paymentId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const receiptId = "33333333-3333-4333-8333-333333333333";
const refundId = "44444444-4444-4444-8444-444444444444";
const now = Date.parse("2026-09-08T12:00:00Z");
const configuration = {
  baseUrl: "https://api.yookassa.ru/v3",
  shopId: "mock-shop",
  secretKey: "mock-secret",
  returnUrl: "https://example.test/checkout/payment/return",
  webhookUrl: "https://example.test/api/webhooks/yookassa"
};
const item = { productName: "Meal", quantity: 1, unitPrice: "100.00", lineTotal: "100.00" };

// Execute the current TypeScript in memory. Unexpected imports/network access fail closed.
function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  return function load(path) {
    const filename = resolve(root, path);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const require = (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === "server-only") return {};
      if (name === "node:crypto") return nativeRequire(name);
      if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
      throw new Error(`Unmocked dependency: ${name}`);
    };
    runInNewContext(code, {
      module: loadedModule, exports: loadedModule.exports, require, Buffer, Response, URL, AbortController, Error,
      setTimeout, clearTimeout,
      fetch: () => { throw new Error("Real network forbidden in payment tests"); },
      ...globals
    }, { filename });
    return loadedModule.exports;
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(overrides = {}) {
  let clock = now;
  const calls = [];
  const saved = [];
  const failures = [];
  const context = {
    amount: "100.00", createdAt: new Date(now - 60_000).toISOString(), id: paymentId,
    idempotencyKey: paymentId, orderId, displayNumber: "TEST-1", status: "pending",
    items: [item], receiptEmail: "buyer@example.test", receiptRegistration: "succeeded",
    providerPaymentId: null, ...overrides.payment
  };
  const fiscal = {
    ...context, id: receiptId, paymentId, providerPaymentId: "provider-payment",
    providerReceiptId: null, idempotencyKey: `yookassa:payment:${paymentId}:settlement`,
    ...overrides.fiscal
  };
  const refund = {
    ...context, id: refundId, paymentId, idempotencyKey: refundId,
    providerPaymentId: "provider-payment", providerRefundId: null, isFullRefund: false,
    ...overrides.refund
  };
  const events = new Map();
  const fingerprints = new Map();
  const bind = async (id, fingerprint) => {
    if (fingerprints.has(id) && fingerprints.get(id) !== fingerprint) throw new Error("FINGERPRINT_MISMATCH");
    fingerprints.set(id, fingerprint);
  };
  const repository = {
    getYooKassaPaymentContext: async () => ({ ...context }),
    getFiscalReceiptContext: async () => ({ ...fiscal }),
    getYooKassaRefundContext: async () => ({ ...refund }),
    bindPaymentRequestFingerprint: bind,
    bindFiscalReceiptRequestFingerprint: bind,
    bindRefundRequestFingerprint: bind,
    recordYooKassaPaymentCreated: async (_id, payment) => { context.providerPaymentId = payment.id; },
    applyYooKassaPaymentState: async (_id, payment) => { saved.push(payment); },
    recordFiscalReceiptState: async (_id, receipt) => {
      saved.push(receipt);
      fiscal.providerReceiptId = receipt.id;
      fiscal.status = receipt.status === "succeeded" ? "issued" : "pending";
    },
    applyYooKassaRefundState: async (_id, response) => { saved.push(response); refund.providerRefundId = response.id; },
    markYooKassaPaymentFailure: async (failure) => { failures.push(failure); },
    markYooKassaRefundFailure: async (failure) => { failures.push(failure); },
    markFiscalReceiptFailure: async (...failure) => { failures.push(failure); },
    releaseFiscalReceiptClaim: async () => { saved.push("released"); },
    findInternalPaymentId: async () => paymentId,
    findInternalRefundId: async () => refundId,
    insertPaymentEvent: async ({ eventId }) => events.get(eventId) ?? { processed_at: null },
    finishPaymentEvent: async (id, state) => {
      events.set(id, { ...state, processed_at: (state.processed ?? !state.errorCode) ? "done" : null });
    },
    ...overrides.repository
  };
  const load = loader({
    "./repository": repository,
    "./config": {
      requireYooKassaConfiguration: () => configuration,
      isYooKassaCheckoutEnabled: () => true,
      isYooKassaReconciliationEnabled: () => true
    },
    "@/lib/observability": { logOperationalEvent() {}, logOperationalError() {} }
  }, { Date: class extends Date { static now() { return clock; } } });
  const { YooKassaClient } = load("src/lib/payments/yookassa/client.ts");
  const service = load("src/lib/payments/yookassa/service.ts");
  const client = new YooKassaClient(configuration, {
    random: () => 0.5,
    sleep: async () => { overrides.sleep?.(() => { clock += 120_000; }); },
    fetchImpl: async (url, options) => {
      const call = { url, method: options.method, body: options.body, key: options.headers["Idempotence-Key"] };
      calls.push(call);
      if (overrides.fetch) return overrides.fetch(call, calls.length);
      const body = url.includes("/receipts")
        ? { id: "provider-receipt", payment_id: "provider-payment", type: "payment", status: "succeeded" }
        : url.includes("/refunds")
          ? { id: "provider-refund", payment_id: "provider-payment", status: "succeeded", amount: { value: "100.00", currency: "RUB" } }
          : {
              id: "provider-payment", status: "pending", paid: false, test: true,
              amount: { value: "100.00", currency: "RUB" },
              metadata: { order_id: orderId, payment_id: paymentId },
              confirmation: { confirmation_url: "https://example.test/mock-pay" },
              ...overrides.response
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  return { service, client, factory: () => client, calls, saved, failures, context, fiscal, refund, events };
}

test("settlement uses the persisted colon-delimited key and never POSTs again once issued", async () => {
  const h = harness();
  await h.service.reconcileYooKassaFiscalReceipt(receiptId, h.factory);
  await h.service.reconcileYooKassaFiscalReceipt(receiptId, h.factory);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(h.calls[0].key, `yookassa:payment:${paymentId}:settlement`);
  const body = JSON.parse(h.calls[0].body);
  assert.equal(body.items[0].payment_mode, "full_payment");
  assert.deepEqual(body.settlements, [{ type: "prepayment", amount: { value: "100.00", currency: "RUB" } }]);
});

for (const operation of ["payment", "refund", "fiscal"]) {
  test(`${operation}: no provider ID after 24h requires review, not a new POST`, async () => {
    const h = harness({ [operation]: { createdAt: new Date(now - 25 * 3600_000).toISOString() } });
    const execute = operation === "payment" ? "reconcileYooKassaPayment"
      : operation === "refund" ? "reconcileYooKassaRefund" : "reconcileYooKassaFiscalReceipt";
    await assert.rejects(h.service[execute](paymentId, h.factory), { providerCode: "IDEMPOTENCE_WINDOW_EXPIRED", retryable: false });
    assert.equal(h.calls.length, 0);
    assert.equal(h.saved.length, 0);
  });
}

test("mocked checkout recovers by GET and duplicate verified webhook is not applied twice", async () => {
  const h = harness();
  await h.service.createYooKassaPaymentForOrder(paymentId, h.factory);
  await h.service.createYooKassaPaymentForOrder(paymentId, h.factory);
  const params = { event: "payment.succeeded", objectId: "provider-payment" };
  await h.service.processYooKassaWebhook(params, h.factory);
  const applied = h.saved.length;
  const duplicate = await h.service.processYooKassaWebhook(params, h.factory);
  assert.equal(duplicate.duplicate, true);
  assert.equal(h.saved.length, applied);
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.equal(h.saved.at(-1).status, "pending", "event name must not substitute for provider GET state");
  assert.equal(JSON.parse(h.calls[0].body).receipt.items[0].payment_mode, "full_prepayment");
});

test("provider binding mismatch never reaches payment state application", async () => {
  for (const response of [
    { amount: { value: "99.99", currency: "RUB" } },
    { amount: { value: "100.00", currency: "USD" } },
    { metadata: { order_id: "wrong", payment_id: paymentId } },
    { id: "different-provider-id" }
  ]) {
    const h = harness({ payment: { providerPaymentId: "provider-payment" }, response });
    await assert.rejects(h.service.processYooKassaWebhook({ event: "payment.succeeded", objectId: "provider-payment" }, h.factory));
    assert.equal(h.saved.length, 0);
    assert.equal(h.calls.length, 1);
  }
});

test("payment success does not POST any additional receipt", async () => {
  const h = harness({ response: { status: "succeeded", paid: true, receipt_registration: "succeeded" } });
  await h.service.createYooKassaPaymentForOrder(paymentId, h.factory);
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].url.endsWith("/payments"));
  assert.equal(h.saved[0].test, true);
});

test("fiscal settlement waits for the prepayment receipt", async () => {
  const h = harness({ fiscal: { receiptRegistration: "pending" } });
  const result = await h.service.reconcileYooKassaFiscalReceipt(receiptId, h.factory);
  assert.equal(result.reason, "prepayment_receipt_pending");
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.saved, ["released"]);
});

test("refund retry preserves amount, items, key and payload; full refund omits a duplicate receipt", async () => {
  for (const isFullRefund of [false, true]) {
    const h = harness({ refund: { isFullRefund } });
    await h.service.reconcileYooKassaRefund(refundId, h.factory);
    await h.service.reconcileYooKassaRefund(refundId, h.factory);
    assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET"]);
    const body = JSON.parse(h.calls[0].body);
    assert.equal(body.amount.value, "100.00");
    assert.equal("receipt" in body, !isFullRefund);
    if (!isFullRefund) assert.equal(body.receipt.items[0].payment_mode, "full_prepayment");
  }
});

test("cart clears only the verified payment snapshot and never deletes a changed cart", () => {
  for (const changed of [false, true]) {
    const makeStorage = () => {
      const values = new Map();
      return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    };
    const window = { localStorage: makeStorage(), sessionStorage: makeStorage(), dispatchEvent() {} };
    const cart = loader({}, { window, crypto: nativeRequire("node:crypto"), CustomEvent: class {} })("src/lib/cart-checkout-storage.ts");
    window.localStorage.setItem(cart.CART_STORAGE_KEY, "original");
    const key = cart.getOrCreateCheckoutRequestId("payload");
    assert.equal(cart.getOrCreateCheckoutRequestId("payload"), key);
    cart.rememberCheckoutPayment({ cartPayload: "payload", idempotencyKey: key, paymentId });
    assert.equal(cart.finishVerifiedCheckoutPayment(refundId), false);
    if (changed) window.localStorage.setItem(cart.CART_STORAGE_KEY, "changed");
    assert.equal(cart.finishVerifiedCheckoutPayment(paymentId), !changed);
    assert.equal(window.localStorage.getItem(cart.CART_STORAGE_KEY), changed ? "changed" : null);
    assert.equal(cart.finishVerifiedCheckoutPayment(paymentId), false);
  }
});

test("status read requires ownership and performs no provider calls", async () => {
  let customer = null;
  const lookups = [];
  const route = loader({
    "next/server": { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    "@/lib/customer-auth": { getCurrentCustomer: async () => customer },
    "@/lib/payments/yookassa/repository": { getCustomerPaymentStatus: async (id, owner) => { lookups.push([id, owner]); return null; } }
  })("src/app/api/payments/[id]/status/route.ts");
  const request = { params: Promise.resolve({ id: paymentId }) };
  assert.equal((await route.GET({}, request)).status, 401);
  assert.equal(lookups.length, 0);
  customer = { id: "current-customer" };
  assert.equal((await route.GET({}, request)).status, 404);
  assert.deepEqual(plain(lookups), [[paymentId, "current-customer"]]);
});

for (const operation of ["payment", "refund", "fiscal"]) {
  const execute = operation === "payment" ? "reconcileYooKassaPayment"
    : operation === "refund" ? "reconcileYooKassaRefund" : "reconcileYooKassaFiscalReceipt";
  const idField = operation === "payment" ? "providerPaymentId"
    : operation === "refund" ? "providerRefundId" : "providerReceiptId";

  test(`${operation}: known provider ID remains GET-only after 24h`, async () => {
    const h = harness({ [operation]: {
      createdAt: new Date(now - 25 * 3600_000).toISOString(),
      [idField]: operation === "fiscal" ? "provider-receipt" : `provider-${operation}`
    } });
    await h.service[execute](paymentId, h.factory);
    assert.deepEqual(h.calls.map((call) => call.method), ["GET"]);
  });

  test(`${operation}: an ambiguous POST is not retried across the deadline`, async () => {
    const h = harness({
      [operation]: { createdAt: new Date(now - 24 * 3600_000 + 120_000).toISOString() },
      sleep: (advanceClock) => advanceClock(),
      fetch: async () => new Response('{"code":"internal_server_error"}', { status: 500 })
    });
    await assert.rejects(h.service[execute](paymentId, h.factory), { providerCode: "IDEMPOTENCE_WINDOW_EXPIRED" });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, "POST");
  });

  test(`${operation}: missing or invalid persisted creation time fails closed`, async () => {
    for (const createdAt of [undefined, "not-a-date"]) {
      const h = harness({ [operation]: { createdAt } });
      await assert.rejects(h.service[execute](paymentId, h.factory), { providerCode: "IDEMPOTENCE_WINDOW_EXPIRED" });
      assert.equal(h.calls.length, 0);
    }
  });
}

test("all POST endpoints reuse the exact serialized body and key after lost responses", async () => {
  for (const method of ["createPayment", "createRefund", "createReceipt"]) {
    const input = { amount: { value: "100.00", currency: "RUB" } };
    const h = harness({ fetch: async (_call, count) => {
      if (count === 1) {
        input.amount.value = "999.00";
        throw new Error("response lost");
      }
      return new Response('{"id":"same-mock-operation","status":"pending"}', { status: 200 });
    } });
    await h.client[method](input, "key:with:colons", now + 60_000);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].key, h.calls[1].key);
    assert.equal(h.calls[0].body, h.calls[1].body);
    assert.equal(JSON.parse(h.calls[1].body).amount.value, "100.00");
  }
});

test("key validation accepts 64 characters and rejects overlength and header injection", async () => {
  const h = harness();
  await h.client.createReceipt({}, "a".repeat(64));
  for (const key of ["", "a".repeat(65), "key\r\nInjected: value"]) {
    await assert.rejects(h.client.createReceipt({}, key), { providerCode: "INVALID_IDEMPOTENCE_KEY" });
  }
  assert.equal(h.calls.length, 1);
});

test("terminal payment attempts and terminal fiscal receipts do not restart", async () => {
  for (const status of ["cancelled", "failed"]) {
    const h = harness({ payment: { status } });
    await assert.rejects(h.service.createYooKassaPaymentForOrder(paymentId, h.factory), { providerCode: "PAYMENT_ATTEMPT_NOT_PENDING" });
    assert.equal(h.calls.length, 0);
  }
  for (const status of ["issued", "failed", "cancelled"]) {
    const h = harness({ fiscal: { status } });
    assert.equal((await h.service.reconcileYooKassaFiscalReceipt(receiptId, h.factory)).skipped, true);
    assert.equal(h.calls.length, 0);
  }
});

test("receipt binding rejects missing/wrong payment, wrong type and wrong provider ID", async () => {
  for (const response of [
    { payment_id: undefined }, { payment_id: "another-payment" },
    { type: "refund" }, { id: "another-receipt" }
  ]) {
    const h = harness({
      fiscal: { providerReceiptId: "provider-receipt" },
      fetch: async () => new Response(JSON.stringify({
        id: "provider-receipt", type: "payment", payment_id: "provider-payment", status: "succeeded", ...response
      }), { status: 200 })
    });
    await assert.rejects(h.service.reconcileYooKassaFiscalReceipt(receiptId, h.factory));
    assert.equal(h.saved.length, 0);
    assert.equal(h.failures[0][2], false, "binding failures must stop automatic receipt retries");
  }
});

test("changed payment body cannot reuse the persisted operation fingerprint", async () => {
  const h = harness();
  await h.service.createYooKassaPaymentForOrder(paymentId, h.factory);
  h.context.receiptEmail = "changed@example.test";
  await assert.rejects(h.service.createYooKassaPaymentForOrder(paymentId, h.factory), /FINGERPRINT_MISMATCH/);
  assert.equal(h.calls.length, 1);
});

function repositoryFixture(responses) {
  const queue = [...responses];
  const queries = [];
  const sql = async (strings, ...values) => {
    queries.push({ text: strings.join("?"), values });
    assert.ok(queue.length, "unexpected database adapter call");
    return queue.shift();
  };
  sql.begin = async (callback) => callback(sql);
  sql.json = (value) => value;
  const repository = loader({ "@/lib/postgres/server": { getPostgresSql: () => sql } })("src/lib/payments/yookassa/repository.ts");
  return { repository, queries };
}

test("repository carries persisted fiscal/refund creation time to the POST deadline", async () => {
  const createdAt = "2026-09-06T10:00:00Z";
  const snapshot = [{ order_item_id: orderId, product_name: "Meal", quantity: 1, unit_price: "100.00", line_total: "100.00" }];
  const h = repositoryFixture([
    [{ id: receiptId, amount: "100.00", created_at: createdAt, status: "pending", provider_payment_id: "p", receipt_snapshot: snapshot }],
    [{ id: refundId, amount: "100.00", created_at: createdAt, status: "pending", provider_payment_id: "p", receipt_email: "buyer@example.test", metadata: { refund_kind: "full" } }]
  ]);
  const fiscal = await h.repository.getFiscalReceiptContext(receiptId);
  const refund = await h.repository.getYooKassaRefundContext(refundId);
  assert.equal(fiscal.createdAt, createdAt);
  assert.equal(fiscal.status, "pending");
  assert.equal(refund.createdAt, createdAt);
});

test("refund allocation guards execute before any insert, including reserved money and units", async () => {
  const snapshot = [{ order_item_id: orderId, product_name: "Meal", quantity: 2, unit_price: "100.00", line_total: "200.00" }];
  const payment = {
    amount: "200.00", refundable_amount: "200.00", status: "paid", kitchen_status: "ready",
    provider_payment_id: "provider-payment", receipt_email: "buyer@example.test", receipt_snapshot: snapshot
  };
  const params = {
    amount: "100.00", createdByStaffId: receiptId, idempotencyKey: refundId, paymentId,
    reason: "Mocked audit refund", allocations: [{ orderItemId: orderId, quantity: 1 }]
  };
  const cases = [
    { responses: [[]], error: "REFUND_ACTOR_NOT_AUTHORIZED" },
    { reserved: { pending_amount: "150.00", active_count: 1 }, error: "REFUND_AMOUNT_EXCEEDS_AVAILABLE" },
    { params: { allocations: [] }, error: "PARTIAL_REFUND_ITEMS_REQUIRED" },
    { prior: [{ order_item_id: orderId, quantity: "2" }], error: "REFUND_QUANTITY_EXCEEDS_AVAILABLE" },
    { params: { amount: "99.99" }, prior: [], error: "REFUND_ITEMS_TOTAL_MISMATCH" },
    { payment: { kitchen_status: "handed_out" }, error: "PARTIAL_REFUND_AFTER_HANDOFF_UNSUPPORTED" }
  ];
  for (const entry of cases) {
    const h = repositoryFixture(entry.responses ?? [
      [{ id: receiptId }], [{ ...payment, ...entry.payment }], [],
      [{ pending_amount: "0.00", active_count: 0, ...entry.reserved }], ...(entry.prior ? [entry.prior] : [])
    ]);
    await assert.rejects(h.repository.createYooKassaRefundAttempt({ ...params, ...entry.params }), { message: entry.error });
    assert.ok(h.queries.every((query) => !/\binsert\b/i.test(query.text)));
  }
});

test("Evotor manual reconciliation refuses cross-location and unauthorized links", async () => {
  for (const wrongLocation of [false, true]) {
    const queries = [];
    const sql = async (strings) => {
      const text = strings.join("?");
      queries.push(text);
      if (queries.length === 1) return [{ id: orderId, location_id: "location-a", source: "web" }];
      if (queries.length === 2) return [{ id: receiptId, location_id: wrongLocation ? "location-b" : "location-a" }];
      if (queries.length === 3) return [{ allowed: false }];
      throw new Error("unexpected database adapter call");
    };
    sql.begin = async (callback) => callback(sql);
    const redirects = [];
    const actions = loader({
      "next/cache": { revalidatePath() {} },
      "next/navigation": { redirect: (url) => { redirects.push(decodeURIComponent(url)); throw new Error("NEXT_REDIRECT"); } },
      "@/lib/admin-auth": { getCurrentStaff: async () => ({ id: paymentId, role: "manager", legacy: false }) },
      "@/lib/postgres/server": { getPostgresSql: () => sql }
    }, { process: { env: {} } })("src/app/admin/integrations/evotor/reconciliation/actions.ts");
    const values = new Map([["order_id", orderId], ["receipt_id", receiptId]]);
    await assert.rejects(actions.confirmSaleReconciliationAction(values), /NEXT_REDIRECT/);
    assert.ok(redirects.at(-1).includes(wrongLocation ? "разным точкам" : "недоступна"));
    assert.ok(queries.every((query) => !/\binsert\b/i.test(query)));
  }
});
