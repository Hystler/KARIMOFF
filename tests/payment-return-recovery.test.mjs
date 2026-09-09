import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness(fetcher) {
  const callbacks = [], updates = [], timers = new Map();
  let cleared = 0;
  const hooks = {
    useState: (initial) => [typeof initial === "function" ? initial() : initial, (value) => updates.push(value)],
    useRef: (current) => ({ current }), useEffect() {},
    useCallback: (callback) => { callbacks.push(callback); return callback; }
  };
  const source = ts.transpileModule(readFileSync("src/components/payments/PaymentReturnStatus.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exported = {};
  const requireMock = (id) => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (["lucide-react", "next/link", "@/components/auth/AuthDocumentLink", "@/lib/cart-checkout-storage"].includes(id)) return {};
    throw new Error(`Unexpected import: ${id}`);
  };
  const documentMock = { visibilityState: "visible" };
  const windowMock = {
    setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 8000); timers.set(1, callback); return 1; },
    clearTimeout: (id) => { timers.delete(id); cleared++; }
  };
  new Function("require", "exports", "window", "document", "fetch", source)(requireMock, exported, windowMock, documentMock, fetcher);
  exported.PaymentReturnStatus({ initialOrderNumber: "A-001", initialStatus: "pending", paymentId: "fixture" });
  return { check: callbacks[0], updates, timers, documentMock, cleared: () => cleared };
}

test("payment status recovers after an offline request without a false failure or rejected promise", async () => {
  let calls = 0;
  const h = harness(async (_url, options) => {
    assert.ok(options.signal);
    if (++calls === 1) throw new TypeError("offline");
    return { ok: true, json: async () => ({ ok: true, payment: { orderNumber: "A-001", status: "paid" } }) };
  });
  await h.check();
  assert.deepEqual(h.updates, []);
  await h.check();
  assert.deepEqual(h.updates, ["A-001", "paid"]);
  assert.equal(h.cleared(), 2);
});

test("a hung payment poll is aborted and does not leave the coordinator locked", async () => {
  let calls = 0;
  const h = harness((_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  for (let i = 0; i < 2; i++) {
    const pending = h.check();
    await h.check();
    assert.equal(calls, i + 1, "one request in flight");
    h.timers.get(1)();
    await pending;
  }
  assert.deepEqual(h.updates, []);
  assert.equal(h.timers.size, 0);
});

test("hidden pages do not initiate payment checks", async () => {
  const h = harness(() => { throw new Error("must not call provider or status endpoint"); });
  h.documentMock.visibilityState = "hidden";
  await h.check();
  assert.equal(h.timers.size, 0);
});
