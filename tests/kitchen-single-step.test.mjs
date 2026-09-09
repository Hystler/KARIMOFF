import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

export function loadOrderService(database, testMode = true) {
  const compiled = ts.transpileModule(readFileSync("src/lib/order-flow/service.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exported = {};
  new Function("require", "exports", "process", compiled)((id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/postgres/server") return { getPostgresSql: () => database };
    if (id === "@/lib/observability") return { logOperationalEvent() {} };
    if (id === "@/lib/database/server") return { createDatabaseServerClient() { throw new Error("unexpected legacy adapter"); } };
    throw new Error(`Unexpected import ${id}`);
  }, exported, { env: { TEST_ORDER_MODE: String(testMode) } });
  return exported;
}

function harness(initial, { testMode = true, failCooking = false } = {}) {
  const order = { kitchen_status: "new", is_test: true, source: "pos", payment_status: "unpaid", ...initial };
  const calls = [];
  let transactions = 0;
  const database = { begin: async (callback) => {
    transactions++;
    const before = { ...order };
    const sql = async (strings, ...values) => {
      if (strings.join("").includes("for update")) return [{ ...order }];
      assert.match(strings.join(""), /set_order_kitchen_status_atomic/);
      const status = values[1];
      calls.push(status);
      if (status === "cooking" && failCooking) throw new Error("fixture failure");
      const duplicate = order.kitchen_status === status;
      order.kitchen_status = status;
      return [{ result: { ok: true, already_applied: duplicate } }];
    };
    try { return await callback(sql); } catch (error) { Object.assign(order, before); throw error; }
  } };
  const service = loadOrderService(database, testMode);
  return { order, calls, transactions: () => transactions, advance: (status) => service.transitionOrder({ orderId: "fixture", status, actorId: null, actorRole: "owner", deviceSource: "kds" }) };
}

test("one start action commits acceptance and cooking in the same transaction", async () => {
  const h = harness();
  await h.advance("cooking");
  assert.deepEqual(h.calls, ["accepted", "cooking"]);
  assert.equal(h.transactions(), 1);
  assert.equal(h.order.kitchen_status, "cooking");
  const replay = await h.advance("cooking");
  assert.equal(replay.already_applied, true);
  assert.deepEqual(h.calls, ["accepted", "cooking", "cooking"]);
});

test("failed cooking rolls back the intermediate acceptance", async () => {
  const h = harness({}, { failCooking: true });
  await assert.rejects(h.advance("cooking"), /fixture failure/);
  assert.equal(h.order.kitchen_status, "new");
});

test("legacy accepted orders continue directly to cooking", async () => {
  const h = harness({ kitchen_status: "accepted" });
  await h.advance("cooking");
  assert.deepEqual(h.calls, ["cooking"]);
});

test("test server cannot mutate a real order, including when it is paid", async () => {
  const h = harness({ is_test: false, payment_status: "paid" });
  await assert.rejects(h.advance("cooking"), { code: "P0001" });
  assert.deepEqual(h.calls, []);
});

test("production cannot mutate a test order", async () => {
  const h = harness({}, { testMode: false });
  await assert.rejects(h.advance("cooking"), { code: "P0001" });
  assert.deepEqual(h.calls, []);
});

test("unpaid real POS order cannot be handed out", async () => {
  const h = harness({ is_test: false, kitchen_status: "ready" }, { testMode: false });
  await assert.rejects(h.advance("handed_out"), /Оплата не подтверждена/);
  assert.deepEqual(h.calls, []);
});

test("paid POS and unpaid training orders can be handed out", async () => {
  for (const [testMode, payment_status] of [[false, "paid"], [true, "unpaid"]]) {
    const h = harness({ is_test: testMode, payment_status, kitchen_status: "ready" }, { testMode });
    await h.advance("handed_out");
    assert.deepEqual(h.calls, ["handed_out"]);
  }
});

test("disposable PG17: POS to cooking, ready and handout with zero stock and no business side effects", {
  skip: process.env.YOOKASSA_AUDIT_LOCAL_DSN ? false : "Requires explicit disposable local DSN"
}, async () => {
  const dsn = process.env.YOOKASSA_AUDIT_LOCAL_DSN;
  assert.equal(dsn, "postgres://postgres@127.0.0.1:55439/karimoff_audit");
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice() {} });
  const rollback = new Error("fixture rollback");
  try {
    await sql.begin(async (transaction) => {
      const [product] = await transaction`select id from public.products where is_active limit 1`;
      const [location] = await transaction`select id from public.order_locations where is_active limit 1`;
      assert.ok(product && location, "Local catalog fixture is required");
      await transaction`update public.inventory_items set current_quantity = 0, reserved_quantity = 0`;
      const [created] = await transaction`
        select * from public.create_pos_order_atomic(
          ${location.id}::uuid, 'Проверка кухни'::text, null::text,
          ${transaction.json([{ product_id: product.id, quantity: 1 }])}::jsonb,
          ${randomUUID()}::uuid, null::uuid, 'owner'::text, 'asap'::text,
          null::timestamptz, true, null::uuid
        )
      `;
      const service = loadOrderService({ begin: callback => callback(transaction) });
      for (const status of ["cooking", "cooking", "ready", "handed_out", "handed_out"]) {
        await service.transitionOrder({ orderId: created.order_id, status, actorId: null, actorRole: "owner", deviceSource: "isolated-kds-test" });
      }
      const [order] = await transaction`select kitchen_status, is_test, payment_status from public.orders where id = ${created.order_id}`;
      assert.equal(order.kitchen_status, "handed_out");
      assert.equal(order.is_test, true);
      assert.notEqual(order.payment_status, "paid");
      const events = await transaction`select to_status from public.order_status_events where order_id = ${created.order_id}`;
      assert.equal(events.filter(event => event.to_status === "cooking").length, 1);
      assert.equal(events.filter(event => event.to_status === "handed_out").length, 1);
      const [counts] = await transaction`
        select (select count(*)::int from public.order_inventory_deductions where order_id = ${created.order_id}) as deductions,
          (select count(*)::int from public.fiscal_receipts where order_id = ${created.order_id}) as receipts,
          (select count(*)::int from public.canonical_analytics_sales where source_record_id::text = ${created.order_id}::text and analytics_included) as sales
      `;
      assert.deepEqual(counts, { deductions: 0, receipts: 0, sales: 0 });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await sql.end({ timeout: 5 }); }
});
