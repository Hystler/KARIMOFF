import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

// Opt-in via one explicit test-only variable. Never load application configuration or .env.
const databaseUrl = process.env.YOOKASSA_AUDIT_LOCAL_DSN;
const enabled = Boolean(databaseUrl);
const localDatabase = { skip: enabled ? false : "Set YOOKASSA_AUDIT_LOCAL_DSN to run disposable PG17 tests" };
const rollback = new Error("ROLLBACK_AUDIT_FIXTURE");

async function withDatabase(callback) {
  if (databaseUrl !== "postgres://postgres@127.0.0.1:55439/karimoff_audit") {
    throw new Error("Only the explicitly authorized disposable PG17 endpoint is allowed");
  }
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 1, onnotice() {} });
  try {
    const [identity] = await sql`select current_database() as name, current_user as username,
      current_setting('server_version_num')::integer as version`;
    assert.equal(identity.name, "karimoff_audit");
    assert.equal(identity.username, "postgres");
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    await callback(sql);
  } finally {
    await sql.unsafe("rollback").catch(() => {});
    await sql.end({ timeout: 5 });
  }
}

async function inRollback(sql, callback) {
  try {
    await sql.begin(async (transaction) => {
      await callback(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function loadRepository(transaction) {
  const adapter = new Proxy(transaction, {
    get(target, name) {
      if (name === "begin") return (callback) => callback(adapter);
      return Reflect.get(target, name);
    }
  });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    runInNewContext(code, {
      module: loadedModule, exports: loadedModule.exports, Date, Error,
      require(name) {
        if (name === "server-only") return {};
        if (name === "@/lib/postgres/server") return { getPostgresSql: () => adapter };
        if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
        throw new Error(`Unapproved database test dependency: ${name}`);
      }
    }, { filename });
    return loadedModule.exports;
  }
  return load(resolve("src/lib/payments/yookassa/repository.ts"));
}

async function fixture(sql, receiptRegistration = "succeeded") {
  const phone = () => `+7${randomInt(1_000_000_000, 9_999_999_999)}`;
  const [customer] = await sql`insert into public.customers (name, phone, phone_verified_at)
    values ('Disposable payment audit', ${phone()}, now()) returning id`;
  const [staff] = await sql`insert into public.staff_users (name, phone, password_hash, role, is_active)
    values ('Disposable audit owner', ${phone()}, 'mock-only', 'owner', true) returning id`;
  const [product] = await sql`insert into public.products (name, slug, category, price, is_active)
    values ('Disposable audit meal', ${`audit-${randomUUID()}`}, 'Test', 100, true) returning id`;
  const [order] = await sql`select * from public.create_site_order_with_payment(
    ${customer.id}::uuid, 'pickup', null, null,
    ${sql.json([{ product_id: product.id, quantity: 2 }])}::jsonb,
    ${randomUUID()}::uuid, true, true, false, 'test', '/test/yookassa-audit', 'test',
    'asap', null, 'mock@example.test', ${randomUUID()})`;
  const providerId = `mock-${randomUUID()}`;
  await sql`select public.apply_yookassa_payment_state(
    ${order.payment_id}::uuid, ${providerId}, 'succeeded', true, 200, 'RUB',
    ${receiptRegistration}, 'bank_card', 200, now(), now())`;
  return { ...order, staffId: staff.id, providerId };
}

async function partialRefund(sql, order, receiptRegistration = "succeeded") {
  const [refund] = await sql`insert into public.refunds
    (payment_id, order_id, provider, idempotency_key, status, amount, reason, created_by_staff_id, metadata)
    values (${order.payment_id}::uuid, ${order.order_id}::uuid, 'yookassa', ${randomUUID()},
      'pending', 100, 'Disposable audit refund', ${order.staffId}::uuid, '{"refund_kind":"partial"}') returning id`;
  await sql`insert into public.refund_items
    (refund_id, order_item_id, description_snapshot, quantity, unit_amount, amount)
    select ${refund.id}::uuid, id, product_name, 1, unit_price, unit_price
    from public.order_items where order_id = ${order.order_id}::uuid`;
  await sql`insert into public.fiscal_receipts
    (order_id, payment_id, refund_id, provider, receipt_type, receipt_phase, status, idempotency_key, amount)
    values (${order.order_id}::uuid, ${order.payment_id}::uuid, ${refund.id}::uuid,
      'yookassa', 'refund', 'refund', 'pending', ${`yookassa:refund:${refund.id}`}, 100)`;
  const providerId = `mock-refund-${randomUUID()}`;
  await sql`select public.apply_yookassa_refund_state(${refund.id}::uuid,
    ${providerId}, 'succeeded', 100, 'RUB', ${receiptRegistration})`;
  return { id: refund.id, providerId };
}

test("disposable PG17: existing YooKassa SQL transaction suite", localDatabase, async () => {
  await withDatabase(async (sql) => {
    await sql.unsafe(readFileSync(resolve("supabase/tests/yookassa.sql"), "utf8"));
  });
});

test("disposable PG17: actual fiscal recorder preserves issued state against stale responses", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    await transaction`update public.orders set status = 'completed', kitchen_status = 'handed_out'
      where id = ${order.order_id}::uuid`;
    const [row] = await transaction`select id from public.fiscal_receipts
      where payment_id = ${order.payment_id}::uuid and receipt_phase = 'prepayment_settlement'`;
    assert.ok(row);
    const repository = loadRepository(transaction);
    const context = await repository.getFiscalReceiptContext(row.id);
    assert.equal(context.status, "pending");
    assert.ok(Number.isFinite(new Date(context.createdAt).getTime()));
    await repository.markFiscalReceiptFailure(row.id, "IDEMPOTENCE_WINDOW_EXPIRED", false);
    const [stopped] = await transaction`select status, next_reconcile_at from public.fiscal_receipts where id = ${row.id}::uuid`;
    assert.equal(stopped.status, "pending");
    assert.equal(stopped.next_reconcile_at, null);
    const receipt = { id: `mock-receipt-${randomUUID()}`, payment_id: order.providerId, type: "payment", status: "succeeded" };
    await repository.recordFiscalReceiptState(row.id, receipt);
    await repository.recordFiscalReceiptState(row.id, { ...receipt, status: "pending" });
    await repository.recordFiscalReceiptState(row.id, { ...receipt, status: "canceled" });
    await repository.recordFiscalReceiptState(row.id, { ...receipt, id: "wrong-receipt" });
    await repository.markFiscalReceiptFailure(row.id, "STALE_FAILURE", true);
    const [result] = await transaction`select status, provider_status, provider_receipt_id, next_reconcile_at,
      last_error_code from public.fiscal_receipts where id = ${row.id}::uuid`;
    assert.equal(result.status, "issued");
    assert.equal(result.provider_status, "succeeded");
    assert.equal(result.provider_receipt_id, receipt.id);
    assert.equal(result.next_reconcile_at, null);
    assert.equal(result.last_error_code, null);
  }));
});

test("disposable PG17: confirmed Evotor link counts one sale and one payment", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    await transaction`update public.orders set status = 'completed', kitchen_status = 'handed_out'
      where id = ${order.order_id}::uuid`;
    const [connection] = await transaction`insert into public.evotor_connections
      (evotor_user_id, encrypted_token, token_fingerprint)
      values (${randomUUID()}, 'mock-no-token', ${randomUUID()}) returning id`;
    const [store] = await transaction`insert into public.evotor_stores (connection_id, evotor_store_id, name)
      values (${connection.id}::uuid, ${randomUUID()}, 'Disposable audit store') returning id`;
    const documentId = randomUUID();
    const [document] = await transaction`insert into public.evotor_documents
      (connection_id, store_id, evotor_document_id, document_type, close_date)
      values (${connection.id}::uuid, ${store.id}::uuid, ${documentId}, 'SELL', now()) returning id`;
    const [receipt] = await transaction`insert into public.evotor_receipts
      (connection_id, document_id, store_id, external_receipt_id, receipt_type, closed_at, total, payment_types)
      values (${connection.id}::uuid, ${document.id}::uuid, ${store.id}::uuid, ${documentId},
        'sale', now(), 200, '[{"type":"CARD","sum":200}]') returning id`;
    const saleIds = [`web:${order.order_id}`, `pos_evotor:${receipt.id}`];
    const [unlinked] = await transaction`select count(*)::integer as count, sum(net_revenue)::text as revenue
      from public.canonical_analytics_sales where sale_id = any(${saleIds}::text[]) and analytics_included`;
    assert.equal(unlinked.count, 2, "unconfirmed duplicate sources remain separate");
    assert.equal(Number(unlinked.revenue), 400);
    await transaction`insert into public.analytics_sale_reconciliations
      (web_order_id, evotor_receipt_id, status, match_method, confirmed_by, confirmed_at)
      values (${order.order_id}::uuid, ${receipt.id}::uuid, 'confirmed', 'manual', ${order.staffId}, now())`;
    const [linked] = await transaction`select count(*)::integer as count, sum(net_revenue)::text as revenue
      from public.canonical_analytics_sales where sale_id = any(${saleIds}::text[]) and analytics_included`;
    const [payments] = await transaction`select count(*)::integer as count, sum(amount)::text as amount
      from public.analytics_sale_payments where sale_id = any(${saleIds}::text[])`;
    assert.equal(linked.count, 1);
    assert.equal(Number(linked.revenue), 200);
    assert.equal(payments.count, 1);
    assert.equal(Number(payments.amount), 200);
  }));
});

test("disposable PG17: completed refund must not regress on stale pending", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const refund = await partialRefund(transaction, order);
    await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid,
      ${refund.providerId}, 'pending', 100, 'RUB', 'pending')`;
    const [row] = await transaction`select status from public.refunds where id = ${refund.id}::uuid`;
    assert.equal(row.status, "completed");
  }));
});

test("disposable PG17: stale payment must not restore already refunded money", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    await partialRefund(transaction, order);
    await transaction`select public.apply_yookassa_payment_state(
      ${order.payment_id}::uuid, ${order.providerId}, 'succeeded', true, 200, 'RUB',
      'succeeded', 'bank_card', 200, now(), now())`;
    const [row] = await transaction`select refundable_amount::text as amount from public.payments where id = ${order.payment_id}::uuid`;
    assert.equal(Number(row.amount), 100);
  }));
});

test("disposable PG17: stale financial responses preserve paid provider state and prepayment receipt", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    for (const [refundCount, expectedPaymentStatus, expectedOrderStatus] of [
      [0, "paid", "paid"], [1, "paid", "partially_refunded"], [2, "paid", "refunded"],
      [1, "partially_refunded", "partially_refunded"], [2, "refunded", "refunded"]
    ]) {
      const order = await fixture(transaction);
      for (let count = 0; count < refundCount; count += 1) await partialRefund(transaction, order);
      // Current refund application leaves payments paid; also cover supported legacy financial statuses.
      if (expectedPaymentStatus !== "paid") {
        await transaction`update public.payments set status = ${expectedPaymentStatus} where id = ${order.payment_id}::uuid`;
      }
      for (const status of ["pending", "waiting_for_capture", "canceled"]) {
        await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
          ${order.providerId}, ${status}, false, 200, 'RUB',
          ${status === "canceled" ? "canceled" : "pending"}, null, 0, now(), null)`;
        const [payment] = await transaction`select status, provider_status, receipt_registration,
          refundable_amount::text as amount, next_reconcile_at from public.payments where id = ${order.payment_id}::uuid`;
        assert.equal(payment.status, expectedPaymentStatus);
        assert.equal(payment.provider_status, "succeeded");
        assert.equal(payment.receipt_registration, "succeeded");
        assert.equal(Number(payment.amount), 200 - refundCount * 100);
        assert.equal(payment.next_reconcile_at, null);
        const [receipt] = await transaction`select status, provider_status, receipt_registration from public.fiscal_receipts
          where payment_id = ${order.payment_id}::uuid and receipt_phase = 'payment_prepayment'`;
        assert.equal(receipt.status, "issued");
        assert.equal(receipt.provider_status, "succeeded");
        assert.equal(receipt.receipt_registration, "succeeded");
        const [savedOrder] = await transaction`select payment_status from public.orders where id = ${order.order_id}::uuid`;
        assert.equal(savedOrder.payment_status, expectedOrderStatus);
      }
      const [events] = await transaction`select
        count(*) filter (where event_type = 'order.payment_succeeded')::integer as succeeded,
        count(*) filter (where event_type = 'order.payment_cancelled')::integer as cancelled
        from public.order_outbox where aggregate_id = ${order.order_id}::uuid`;
      assert.equal(events.succeeded, 1);
      assert.equal(events.cancelled, 0);
    }
  }));
});

test("disposable PG17: terminal payment receipt registration survives older or contradictory receipts", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    for (const finalReceipt of ["succeeded", "canceled"]) {
      const order = await fixture(transaction, finalReceipt);
      for (const registration of ["pending", null, "succeeded", "canceled"]) {
        await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
          ${order.providerId}, 'succeeded', true, 200, 'RUB', ${registration}, 'bank_card', 200, now(), now())`;
        const [payment] = await transaction`select status, provider_status, receipt_registration, next_reconcile_at
          from public.payments where id = ${order.payment_id}::uuid`;
        assert.equal(payment.status, "paid");
        assert.equal(payment.provider_status, "succeeded");
        assert.equal(payment.receipt_registration, finalReceipt);
        assert.equal(payment.next_reconcile_at, null);
        const [receipt] = await transaction`select status, provider_status, receipt_registration from public.fiscal_receipts
          where payment_id = ${order.payment_id}::uuid and receipt_phase = 'payment_prepayment'`;
        assert.equal(receipt.status, finalReceipt === "succeeded" ? "issued" : "failed");
        assert.equal(receipt.provider_status, finalReceipt);
        assert.equal(receipt.receipt_registration, finalReceipt);
      }
    }
  }));
});

test("disposable PG17: paid payment still allows its pending prepayment receipt to finish", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    for (const finalReceipt of ["succeeded", "canceled"]) {
      const order = await fixture(transaction, "pending");
      await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
        ${order.providerId}, 'canceled', false, 200, 'RUB', 'canceled', null, 0, now(), null)`;
      const [pending] = await transaction`select receipt_registration, next_reconcile_at
        from public.payments where id = ${order.payment_id}::uuid`;
      assert.equal(pending.receipt_registration, "pending", "stale financial cancellation cannot cancel the pending receipt");
      assert.ok(pending.next_reconcile_at);
      await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
        ${order.providerId}, 'succeeded', true, 200, 'RUB', ${finalReceipt}, 'bank_card', 200, now(), now())`;
      const [payment] = await transaction`select receipt_registration, next_reconcile_at
        from public.payments where id = ${order.payment_id}::uuid`;
      assert.equal(payment.receipt_registration, finalReceipt);
      assert.equal(payment.next_reconcile_at, null);
      const [receipt] = await transaction`select status, receipt_registration from public.fiscal_receipts
        where payment_id = ${order.payment_id}::uuid and receipt_phase = 'payment_prepayment'`;
      assert.equal(receipt.status, finalReceipt === "succeeded" ? "issued" : "failed");
      assert.equal(receipt.receipt_registration, finalReceipt);
    }
  }));
});

test("disposable PG17: terminal prepayment rows are protected even if payment receipt flag is inconsistent", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    for (const status of ["issued", "failed", "cancelled"]) {
      const order = await fixture(transaction, "pending");
      const registration = status === "issued" ? "succeeded" : "canceled";
      const [before] = await transaction`update public.fiscal_receipts
        set status = ${status}, provider_status = ${registration}, receipt_registration = ${registration}
        where payment_id = ${order.payment_id}::uuid and receipt_phase = 'payment_prepayment'
        returning status, provider_status, receipt_registration, fiscalized_at`;
      for (const incoming of ["pending", "canceled", "succeeded"]) {
        await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
          ${order.providerId}, 'succeeded', true, 200, 'RUB', ${incoming}, 'bank_card', 200, now(), now())`;
        const [after] = await transaction`select status, provider_status, receipt_registration, fiscalized_at
          from public.fiscal_receipts where payment_id = ${order.payment_id}::uuid and receipt_phase = 'payment_prepayment'`;
        assert.deepEqual(after, before);
      }
    }
  }));
});

test("disposable PG17: paid-state guard cannot bypass payment binding and consistency checks", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    for (const [id, amount, currency, status, paid] of [
      ["wrong-id", 200, "RUB", "pending", false],
      [order.providerId, 199, "RUB", "pending", false],
      [order.providerId, 200, "USD", "pending", false],
      [order.providerId, 200, "RUB", "succeeded", false]
    ]) {
      await assert.rejects(transaction.savepoint((savepoint) => savepoint`
        select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
          ${id}, ${status}, ${paid}, ${amount}, ${currency}, 'pending', null, 0, now(), null)`),
      { code: "P0001" });
    }
    const [row] = await transaction`select status, provider_status, provider_payment_id from public.payments where id = ${order.payment_id}::uuid`;
    assert.equal(row.status, "paid");
    assert.equal(row.provider_status, "succeeded");
    assert.equal(row.provider_payment_id, order.providerId);
  }));
});

test("disposable PG17: terminal refund and receipt survive pending, canceled and duplicate succeeded", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const refund = await partialRefund(transaction, order);
    for (const status of ["pending", "canceled", "succeeded"]) {
      await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid,
        ${refund.providerId}, ${status}, 100, 'RUB', 'pending')`;
      const [row] = await transaction`select status, provider_status, receipt_registration, next_reconcile_at
        from public.refunds where id = ${refund.id}::uuid`;
      assert.equal(row.status, "completed");
      assert.equal(row.provider_status, "succeeded");
      assert.equal(row.receipt_registration, "succeeded");
      assert.equal(row.next_reconcile_at, null);
      const [receipt] = await transaction`select status, receipt_registration from public.fiscal_receipts where refund_id = ${refund.id}::uuid`;
      assert.equal(receipt.status, "issued");
      assert.equal(receipt.receipt_registration, "succeeded");
    }
    const [events] = await transaction`select count(*)::integer as count from public.order_outbox
      where idempotency_key = ${`refund:${refund.id}:succeeded`}`;
    assert.equal(events.count, 1);
  }));
});

test("disposable PG17: completed refund still permits pending receipt to finish", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    for (const finalReceipt of ["succeeded", "canceled"]) {
      const order = await fixture(transaction);
      const refund = await partialRefund(transaction, order, "pending");
      await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid,
        ${refund.providerId}, 'succeeded', 100, 'RUB', ${finalReceipt})`;
      await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid,
        ${refund.providerId}, 'succeeded', 100, 'RUB', null)`;
      const [row] = await transaction`select status, receipt_registration, next_reconcile_at
        from public.refunds where id = ${refund.id}::uuid`;
      assert.equal(row.status, "completed");
      assert.equal(row.receipt_registration, finalReceipt);
      assert.equal(row.next_reconcile_at, null);
      const [receipt] = await transaction`select status from public.fiscal_receipts where refund_id = ${refund.id}::uuid`;
      assert.equal(receipt.status, finalReceipt === "succeeded" ? "issued" : "failed");
    }
  }));
});

test("disposable PG17: canceled refund cannot be revived or counted as completed", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const repository = loadRepository(transaction);
    const [item] = await transaction`select id from public.order_items where order_id = ${order.order_id}::uuid`;
    const id = await repository.createYooKassaRefundAttempt({
      amount: "100.00", paymentId: order.payment_id, createdByStaffId: order.staffId,
      idempotencyKey: randomUUID(), reason: "Mock canceled refund", allocations: [{ orderItemId: item.id, quantity: 1 }]
    });
    const providerId = `mock-${randomUUID()}`;
    for (const status of ["canceled", "pending", "succeeded"]) {
      await transaction`select public.apply_yookassa_refund_state(${id}::uuid, ${providerId}, ${status}, 100, 'RUB', 'pending')`;
    }
    const [row] = await transaction`select status, provider_status, next_reconcile_at from public.refunds where id = ${id}::uuid`;
    assert.equal(row.status, "failed");
    assert.equal(row.provider_status, "canceled");
    assert.equal(row.next_reconcile_at, null);
    const [events] = await transaction`select count(*)::integer as count from public.order_outbox where idempotency_key = ${`refund:${id}:succeeded`}`;
    assert.equal(events.count, 0);
    const [payment] = await transaction`select refundable_amount::text as amount from public.payments where id = ${order.payment_id}::uuid`;
    assert.equal(Number(payment.amount), 200);
  }));
});

test("disposable PG17: provider ceilings, zero and full-refund cap survive refund replay", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const refund = await partialRefund(transaction, order);
    for (const [providerAmount, expected] of [[999, 100], [100, 100], [50, 50], [-1, 0], [0, 0], [null, 0]]) {
      await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
        ${order.providerId}, 'succeeded', true, 200, 'RUB', 'succeeded', 'bank_card', ${providerAmount}, now(), now())`;
      await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid,
        ${refund.providerId}, 'succeeded', 100, 'RUB', 'succeeded')`;
      const [row] = await transaction`select refundable_amount::text as amount from public.payments where id = ${order.payment_id}::uuid`;
      assert.equal(Number(row.amount), expected);
    }
    await partialRefund(transaction, order);
    await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
      ${order.providerId}, 'succeeded', true, 200, 'RUB', 'succeeded', 'bank_card', 200, now(), now())`;
    const [row] = await transaction`select refundable_amount::text as amount from public.payments where id = ${order.payment_id}::uuid`;
    assert.equal(Number(row.amount), 0);
  }));
});

test("disposable PG17: remaining money can be reserved once after stale payment replay", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    await partialRefund(transaction, order);
    await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
      ${order.providerId}, 'succeeded', true, 200, 'RUB', 'succeeded', 'bank_card', 200, now(), now())`;
    const repository = loadRepository(transaction);
    const [item] = await transaction`select id from public.order_items where order_id = ${order.order_id}::uuid`;
    const params = {
      amount: "100.00", paymentId: order.payment_id, createdByStaffId: order.staffId,
      idempotencyKey: randomUUID(), reason: "Mock remaining refund", allocations: [{ orderItemId: item.id, quantity: 1 }]
    };
    const refundId = await repository.createYooKassaRefundAttempt(params);
    assert.equal(await repository.createYooKassaRefundAttempt(params), refundId);
    await assert.rejects(repository.createYooKassaRefundAttempt({ ...params, idempotencyKey: randomUUID() }),
      { message: "REFUND_AMOUNT_EXCEEDS_AVAILABLE" });
  }));
});

test("disposable PG17: terminal-state handling cannot bypass refund binding checks", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const refund = await partialRefund(transaction, order);
    for (const [id, amount, currency] of [["wrong-id", 100, "RUB"], [refund.providerId, 99, "RUB"], [refund.providerId, 100, "USD"]]) {
      await assert.rejects(transaction.savepoint((savepoint) => savepoint`
        select public.apply_yookassa_refund_state(${refund.id}::uuid, ${id}, 'pending', ${amount}, ${currency}, 'pending')`),
      { code: "P0001" });
    }
    const [row] = await transaction`select status, provider_refund_id from public.refunds where id = ${refund.id}::uuid`;
    assert.equal(row.status, "completed");
    assert.equal(row.provider_refund_id, refund.providerId);
  }));
});

test("disposable PG17: replacement functions remain invoker-only and executable by app role", localDatabase, async () => {
  await withDatabase((sql) => inRollback(sql, async (transaction) => {
    const order = await fixture(transaction);
    const refund = await partialRefund(transaction, order);
    const functions = await transaction`select prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('apply_yookassa_payment_state', 'apply_yookassa_refund_state')`;
    assert.equal(functions.length, 2);
    assert.ok(functions.every((fn) => fn.prosecdef === false && fn.proconfig.includes("search_path=public, pg_temp")));
    await transaction`set local role karimoff_app`;
    await transaction`select public.apply_yookassa_refund_state(${refund.id}::uuid, ${refund.providerId}, 'pending', 100, 'RUB', 'pending')`;
    await transaction`select public.apply_yookassa_payment_state(${order.payment_id}::uuid,
      ${order.providerId}, 'succeeded', true, 200, 'RUB', 'succeeded', 'bank_card', 200, now(), now())`;
    const [row] = await transaction`select refundable_amount::text as amount from public.payments where id = ${order.payment_id}::uuid`;
    assert.equal(Number(row.amount), 100);
  }));
});
