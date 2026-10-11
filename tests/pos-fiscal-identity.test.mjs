import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const activity = read('android/evotor-bridge/app/src/main/java/ru/karimoff/evotor/bridge/MainActivity.java');
const payments = read('src/lib/integrations/evotor/pos-payments.ts');
const migration = read('database/migrations/20261003120000_pos_fiscal_identity.sql');
const sync = read('src/lib/integrations/evotor/sync.ts');
const receiptRoute = read('src/app/api/terminal/payments/[id]/receipt/route.ts');
const resultRoute = read('src/app/api/terminal/payments/[id]/result/route.ts');

function reconciliationWith({ receipt = {}, groups = [], intents = [{}], copies = [{}], insert = true } = {}) {
  const source = ts.transpileModule(read('src/lib/integrations/evotor/fiscal-reconciliation.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', source)(id => {
    if (id === 'server-only') return {};
    throw new Error(`Unexpected import: ${id}`);
  }, exports);
  const queries = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    queries.push({ query, values });
    if (query.includes('select receipt.id, receipt.external_receipt_id')) return [{
      id: 'receipt-1', external_receipt_id: 'cloud-1', fiscal_drive_number: 'fn-1',
      fiscal_document_number: 'fd-1', fiscal_sign: 'fp-1', total: 100,
      location_id: 'location-1', evotor_device_id: 'device-1', evotor_store_id: 'store-1', ...receipt
    }];
    if (query.includes('select group_index, fiscal_storage_number')) return groups;
    if (query.includes('select intent.id, intent.order_id')) {
      const selected = typeof intents === 'function' ? intents(values) : intents;
      return selected.map((item, index) => ({
      id: `intent-${index}`, order_id: `order-${index}`, payment_id: `payment-${index}`, ...item
      }));
    }
    if (query.includes('select other.id')) return copies.map((item, index) => ({ id: `receipt-${index}`, ...item }));
    if (query.includes('insert into public.analytics_sale_reconciliations')) return insert ? [{ id: 'link-1' }] : [];
    return [];
  };
  return { reconcile: id => exports.reconcileEvotorReceipt(sql, id), queries };
}

test('bridge stores receipt identity locally and on server before SellApi can start', () => {
  const method = activity.slice(activity.indexOf('private void saveReceiptBeforePayment('),
    activity.indexOf('private void moveReceiptToCardPayment('));
  assert.match(method, /ReceiptApi\.getReceipt\(this, Receipt\.Type\.SELL\)/);
  assert.match(method, /performer\.getPaymentSystem\(\)/);
  assert.match(method, /getPaymentSystemId\(\)/);
  assert.doesNotMatch(method, /getPackageName\(\)|getComponentName\(\)/);
  assert.match(method, /putString\(ACTIVE_RECEIPT_KEY, identity\.toString\(\)\)\.commit\(\)/);
  assert.match(method, /"\/receipt", token, body/);
  assert.ok(method.indexOf('putString(ACTIVE_RECEIPT_KEY') < method.indexOf('"/receipt", token, body'));
  assert.ok(method.indexOf('"/receipt", token, body') < method.indexOf('moveReceiptToCardPayment(job, token, performer)'));
  assert.match(method, /queuePaymentResult\(intentId, "failed"/);
  assert.match(method, /body\.put\("paymentSystemId", identity\.getString\("paymentSystemId"\)\)/);
  assert.match(receiptRoute, /paymentSystemId: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(payments, /result = coalesce\(result, '\{\}'::jsonb\).*paymentSystemId/s);
  assert.match(payments, /result->>'paymentSystemId' = \$\{params\.paymentSystemId\}/);
  assert.doesNotMatch(method.slice(method.indexOf('catch (Throwable error) {')), /moveReceiptToCardPayment\(job, token, performer\)/);
});

test('null performer package/component do not block payment when the ELECTRON system ID exists', () => {
  const preparation = activity.slice(activity.indexOf('private void saveReceiptBeforePayment('),
    activity.indexOf('private void moveReceiptToCardPayment('));
  const verification = activity.slice(activity.indexOf('private JSONObject findConfirmedCardPayment('),
    activity.indexOf('private void reportPaymentUnknownOnce('));
  assert.doesNotMatch(preparation, /getPackageName\(\)|getComponentName\(\)/);
  assert.doesNotMatch(verification, /getPackageName\(\)|getComponentName\(\)/);
  assert.match(preparation, /selectedSystem\.getPaymentType\(\) != PaymentType\.ELECTRON/);
  assert.match(verification, /expectedSystem\.equals\(system\.getPaymentSystemId\(\)\)/);
  assert.match(resultRoute, /paymentSystemId: z\.string\(\)\.trim\(\)\.min\(1\)/);
});

test('successful callback uses saved UUID to read closed receipt and keeps delayed recovery active', () => {
  const success = activity.slice(activity.indexOf('public void onSuccess()'), activity.indexOf('public void onError('));
  assert.match(success, /activeReceipt\(\)/);
  assert.match(success, /identity\.put\("paymentStageCallbackReceived", true\)/);
  assert.match(success, /queuePaymentResult\(intentId, "unknown"/);
  assert.doesNotMatch(success, /queuePaymentResult\(intentId, "paid"/);
  assert.doesNotMatch(success, /paymentConfirmed/);
  assert.doesNotMatch(success, /getReceipt\(MainActivity\.this, Receipt\.Type\.SELL\)/);
  assert.match(activity, /ReceiptApi\.getReceipt\(this, uuid\)/);
  assert.match(activity, /ReceiptApi\.getFiscalReceipts\(this, uuid\)/);
  assert.match(activity, /closed\.getHeader\(\)\.getNumber\(\) == null/);
  assert.match(activity, /findConfirmedCardPayment\(closed, identity\)/);
  assert.match(activity, /payment\.getPaymentPerformer\(\)/);
  assert.match(activity, /selectedPayments\.get\(0\)\.getIdentifier\(\)/);
  assert.match(activity, /expectedSystem\.equals\(system\.getPaymentSystemId\(\)\)/);
  assert.match(activity, /if \(!activeReceipt\(\)\.isEmpty\(\)\)/);
  assert.match(activity, /fiscalReadAttempts >= FAST_FISCAL_RETRY_ATTEMPTS/);
  assert.match(activity, /fiscalReadAttempts >= FAST_FISCAL_RETRY_ATTEMPTS\s*\?\s*SLOW_FISCAL_RETRY_DELAY_MS/);
  assert.doesNotMatch(activity, /if \(fiscalReadAttempts >= FAST_FISCAL_RETRY_ATTEMPTS\) \{[^}]*return;/s);
  assert.match(activity, /retryPendingPaymentResult\(\);\s*drainPendingPaymentJob\(\);\s*schedulePaymentPoll\(1500\)/);
  assert.match(activity, /"fiscal_pending"\.equals\(finalStatus\)/);
});

test('opening acquiring screen without a completed card payment cannot become paid or fiscal_pending', () => {
  const success = activity.slice(activity.indexOf('public void onSuccess()'), activity.indexOf('public void onError('));
  assert.match(success, /queuePaymentResult\(intentId, "unknown"/);
  assert.doesNotMatch(success, /queuePaymentResult\(intentId, "paid"/);
  assert.match(activity, /closed\.getHeader\(\)\.getNumber\(\) == null/);
  assert.match(activity, /selectedPayments\.size\(\) != 1/);
  assert.match(activity, /selectedTotal\.compareTo\(expectedTotal\) != 0/);
  assert.match(activity, /paymentIdentifier == null \|\| paymentIdentifier\.trim\(\)\.isEmpty\(\)/);
  assert.match(payments, /!intent\.local_receipt_uuid \|\| !receiptReference \|\| !validPaymentEvidence/);
  assert.match(payments, /paymentEvidence: validPaymentEvidence \? paymentEvidence : null/);
  assert.match(payments, /if \(nextStatus === "paid" && !hasValidEvotorFiscalIdentity\(params\.fiscal/);
});

test('server payment proof rejects an opened or cancelled acquiring flow', () => {
  const source = ts.transpileModule(read('src/lib/integrations/evotor/payment-result.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('exports', source)(exports);
  const valid = {
    receiptClosed: true,
    paymentType: 'ELECTRON',
    total: 40,
    paymentIdentifier: 'rrn-1',
    paymentSystemId: 'sber-card'
  };
  assert.equal(exports.hasValidEvotorPaymentEvidence(null, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({ ...valid, receiptClosed: false }, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({ ...valid, paymentType: 'CASH' }, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({ ...valid, total: 0 }, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({ ...valid, paymentIdentifier: '' }, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence(valid, 40, 'other-bank'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({ ...valid, paymentSystemId: '' }, 40, 'sber-card'), false);
  assert.equal(exports.hasValidEvotorPaymentEvidence({
    ...valid, paymentPerformerPackageName: null, paymentPerformerComponentName: ''
  }, 40, 'sber-card'), true);
  assert.equal(exports.hasValidEvotorPaymentEvidence(valid, 40, 'sber-card'), true);
  assert.equal(exports.hasValidEvotorFiscalIdentity(null, 40), false);
  assert.equal(exports.hasValidEvotorFiscalIdentity({
    storageNumber: '', documentNumber: '1', sign: '2', fiscalizedAt: '2026-10-06T10:30:00.000Z'
  }, 40), false);
});

test('server downgrades paid without card proof to unknown and leaves payment/order pending', async () => {
  const paymentResultSource = ts.transpileModule(read('src/lib/integrations/evotor/payment-result.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const paymentResultExports = {};
  new Function('exports', paymentResultSource)(paymentResultExports);
  const sqlCalls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join(' ');
    sqlCalls.push({ query, values });
    if (query.includes('select intent.id, intent.order_id')) return [{
      id: 'intent-1', order_id: 'order-1', payment_id: 'payment-1', device_id: 'device-1',
      local_receipt_uuid: 'local-receipt-1', amount: 40, status: 'processing',
      result: { paymentSystemId: 'sber-card' },
      display_number: 'B-001', created_by_staff_id: 'staff-1'
    }];
    return [];
  };
  sql.json = value => value;
  const database = { begin: callback => callback(sql) };
  const source = ts.transpileModule(payments, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  const require = id => {
    if (id === 'server-only') return {};
    if (id === '@/lib/postgres/server') return { getPostgresSql: () => database };
    if (id === '@/lib/staging-ui-mode') return { isStagingUiMode: () => false };
    if (id === './terminal-bridge') return { terminalBridgeReady: () => true };
    if (id === './fiscal-reconciliation') return { reconcileEvotorReceipt: async () => true };
    if (id === './payment-result') return paymentResultExports;
    throw new Error(`Unexpected import: ${id}`);
  };
  new Function('require', 'exports', source)(require, exports);

  const outcome = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'paid',
    receiptReference: 'local-receipt-1',
    fiscal: { storageNumber: 'fn', documentNumber: 'fd', sign: 'fp', fiscalizedAt: '2026-10-06T10:30:00.000Z' }
  });
  assert.deepEqual(outcome, { accepted: true, status: 'unknown', orderId: 'order-1' });
  assert.ok(sqlCalls.some(call => call.query.includes('update public.evotor_terminal_payment_intents')
    && call.values.includes('unknown')));
  assert.equal(sqlCalls.some(call => call.query.includes('update public.payments')), false);
  assert.equal(sqlCalls.some(call => call.query.includes('update public.orders')), false);

  sqlCalls.length = 0;
  const confirmed = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'paid',
    receiptReference: 'local-receipt-1',
    paymentEvidence: {
      receiptClosed: true, paymentType: 'ELECTRON', total: 40, paymentIdentifier: 'rrn-1',
      paymentSystemId: 'sber-card'
    }
  });
  assert.deepEqual(confirmed, { accepted: true, status: 'fiscal_pending', orderId: 'order-1' });
  assert.ok(sqlCalls.some(call => call.query.includes('update public.payments')));
  assert.ok(sqlCalls.some(call => call.query.includes('update public.orders')
    && call.query.includes("fiscal_status = 'pending'") && call.query.includes('is_operational = false')));
  assert.equal(sqlCalls.some(call => call.query.includes('insert into public.order_outbox')), false);

  sqlCalls.length = 0;
  const mismatchedSystem = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'paid',
    receiptReference: 'local-receipt-1',
    paymentEvidence: { receiptClosed: true, paymentType: 'ELECTRON', total: 40,
      paymentIdentifier: 'rrn-1', paymentSystemId: 'other-bank' }
  });
  assert.deepEqual(mismatchedSystem, { accepted: true, status: 'unknown', orderId: 'order-1' });
  assert.equal(sqlCalls.some(call => call.query.includes('update public.payments')), false);
  assert.equal(sqlCalls.some(call => call.query.includes('update public.orders')), false);

  sqlCalls.length = 0;
  const wrongReceipt = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'paid',
    receiptReference: 'another-receipt',
    paymentEvidence: { receiptClosed: true, paymentType: 'ELECTRON', total: 40,
      paymentIdentifier: 'rrn-1', paymentSystemId: 'sber-card' }
  });
  assert.deepEqual(wrongReceipt, { accepted: false, status: 'processing' });
  assert.equal(sqlCalls.some(call => call.query.includes('update public.payments')), false);

  sqlCalls.length = 0;
  const paid = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'paid',
    receiptReference: 'local-receipt-1',
    paymentEvidence: {
      receiptClosed: true, paymentType: 'ELECTRON', total: 40,
      paymentIdentifier: 'rrn-1', paymentSystemId: 'sber-card'
    },
    fiscal: {
      storageNumber: 'fn-1', documentNumber: 'fd-1', sign: 'fp-1',
      fiscalizedAt: '2026-10-06T10:30:00.000Z', receiptNumber: '1',
      total: 40, documentType: 'SELL'
    }
  });
  assert.deepEqual(paid, { accepted: true, status: 'paid', orderId: 'order-1' });
  assert.ok(sqlCalls.some(call => call.query.includes('update public.orders')
    && call.query.includes("fiscal_status = 'issued'") && call.query.includes('is_operational = true')));
  assert.ok(sqlCalls.some(call => call.query.includes('insert into public.order_outbox')));

  sqlCalls.length = 0;
  const cancelled = await exports.recordEvotorTerminalPaymentResult({
    deviceId: 'device-1', intentId: 'intent-1', status: 'cancelled', safeBeforePayment: true
  });
  assert.deepEqual(cancelled, { accepted: true, status: 'cancelled', orderId: 'order-1' });
  assert.ok(sqlCalls.some(call => call.query.includes('update public.orders')
    && call.query.includes("payment_status = 'cancelled'")));
  assert.equal(sqlCalls.some(call => call.query.includes("payment_status = 'paid'")), false);
  assert.equal(sqlCalls.some(call => call.query.includes('insert into public.order_outbox')
    && call.query.includes('payment_succeeded')), false);
});

test('POS admin safely renders Postgres timestamps parsed as JavaScript Date objects', () => {
  const source = ts.transpileModule(read('src/lib/integrations/evotor/pos-payment-display.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('exports', source)(exports);
  assert.equal(exports.formatPosPaymentDisplayValue(new Date('2026-10-06T10:30:00.000Z')),
    '2026-10-06T10:30:00.000Z');
  assert.equal(exports.formatPosPaymentDisplayValue(new Date(Number.NaN)), '—');
  assert.equal(exports.formatPosPaymentDisplayValue(null), '—');
  assert.equal(exports.formatPosPaymentDisplayValue(undefined), '—');
  assert.equal(exports.formatPosPaymentDisplayValue('2026-10-06 10:30:00'), '2026-10-06 10:30:00');
  assert.equal(exports.formatPosPaymentDisplayValue(42), 42);
  assert.throws(() => renderToStaticMarkup(React.createElement('dd', null,
    new Date('2026-10-06T10:30:00.000Z'))), /Objects are not valid as a React child/);
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement('dd', null,
    exports.formatPosPaymentDisplayValue(new Date('2026-10-06T10:30:00.000Z')))));
});

test('paid without fiscal identity stays locked and off KDS; exact callback is idempotent', () => {
  assert.match(payments, /nextStatus = "fiscal_pending"/);
  assert.match(payments, /intent\.status === "fiscal_pending" && nextStatus !== "paid"/);
  assert.match(payments, /fiscal_status = 'pending', is_operational = false/);
  assert.match(payments, /if \(intent\.status === "paid"\) return \{ accepted: true, status: "paid"/);
  assert.match(migration, /where status in \('queued', 'processing', 'fiscal_pending', 'unknown'\)/);
  assert.match(migration, /unique index if not exists evotor_terminal_intent_local_receipt_uuid_key/);
  assert.match(migration, /unique index if not exists evotor_terminal_intent_fiscal_identity_key/);
});

test('selected online device is required; no last-seen fallback or parallel task', () => {
  assert.match(payments, /where bridge\.id = \$\{input\.terminalDeviceId\}::uuid/);
  assert.doesNotMatch(payments, /order by last_seen_at desc/);
  assert.match(payments, /Касса занята/);
  assert.match(payments, /Касса не сопоставлена с облачным устройством Эвотор/);
  assert.match(payments, /where device_id = \$\{deviceId\}::uuid and status = 'queued'/);
  const ui = read('src/components/operations/PosWorkspace.tsx');
  assert.match(ui, /availableTerminals\.length === 1/);
  assert.match(ui, /terminalId\s*\? availableTerminals\.some/);
  assert.match(ui, /terminalId && !selectedTerminalId && availableTerminals\.length > 0/);
  assert.match(ui, /useState<TerminalPaymentView \| null>\(null\)/);
  assert.match(ui, /Касса занята/);
  assert.match(ui, /Выберите кассу/);
  assert.match(ui, /name="terminal_device_id" value=\{selectedTerminalId\}/);
  assert.match(ui, /!selectedTerminalId/);
});

test('matching fiscal identity links the existing order and stores cloud document ID', async () => {
  const harness = reconciliationWith();
  assert.equal(await harness.reconcile('receipt-1'), true);
  assert.ok(harness.queries.some(entry => entry.query.includes('insert into public.analytics_sale_reconciliations')));
  assert.ok(harness.queries.some(entry => entry.query.includes('evotor_cloud_document_id =')));
  assert.ok(harness.queries.some(entry => entry.query.includes('intent.evotor_cloud_device_id =')));
  assert.ok(harness.queries.some(entry => entry.query.includes('intent.evotor_cloud_store_id =')));
  assert.match(sync, /await reconcileEvotorReceipt\(transaction, receiptRows\[0\]\.id\)/);
});

test('a later print group can uniquely link; two valid groups require manual review', async () => {
  const groups = [
    { group_index: 0, fiscal_storage_number: 'fn-1', fiscal_document_number: 'fd-1', fiscal_sign: 'fp-1' },
    { group_index: 1, fiscal_storage_number: 'fn-2', fiscal_document_number: 'fd-2', fiscal_sign: 'fp-2' }
  ];
  const unique = reconciliationWith({ receipt: { fiscal_drive_number: null, fiscal_document_number: null,
    fiscal_sign: null }, groups, intents: values => values.includes('fn-2') ? [{}] : [] });
  assert.equal(await unique.reconcile('receipt-1'), true);
  assert.ok(unique.queries.some(entry => entry.query.includes('insert into public.analytics_sale_reconciliations')));
  const ambiguous = reconciliationWith({ groups, intents: [{}] });
  assert.equal(await ambiguous.reconcile('receipt-1'), false);
  assert.ok(!ambiguous.queries.some(entry => entry.query.includes('insert into public.analytics_sale_reconciliations')));
  assert.ok(ambiguous.queries.some(entry => entry.values.includes('ambiguous')));
});

test('incomplete group cannot link, while duplicate fiscal groups are ambiguous', async () => {
  const incomplete = reconciliationWith({
    receipt: { fiscal_drive_number: null, fiscal_document_number: null, fiscal_sign: null },
    groups: [{ group_index: 0, fiscal_storage_number: 'fn-1',
      fiscal_document_number: 'fd-1', fiscal_sign: null }]
  });
  assert.equal(await incomplete.reconcile('receipt-1'), false);
  assert.ok(!incomplete.queries.some(entry => entry.query.includes('select intent.id, intent.order_id')));
  assert.ok(incomplete.queries.some(entry => entry.values.includes('unreconciled')));

  const duplicate = reconciliationWith({
    groups: [0, 1].map(group_index => ({ group_index, fiscal_storage_number: 'fn-1',
      fiscal_document_number: 'fd-1', fiscal_sign: 'fp-1' }))
  });
  assert.equal(await duplicate.reconcile('receipt-1'), false);
  assert.ok(!duplicate.queries.some(entry => entry.query.includes('insert into public.analytics_sale_reconciliations')));
  assert.ok(duplicate.queries.some(entry => entry.values.includes('ambiguous')));
});

test('same amount/time with a different fiscal identity remains unlinked', async () => {
  const harness = reconciliationWith({ intents: [] });
  assert.equal(await harness.reconcile('receipt-1'), false);
  assert.ok(!harness.queries.some(entry => entry.query.includes('insert into public.analytics_sale_reconciliations')));
});

test('missing fiscal identity, ambiguous matches and duplicate import never add a second link', async () => {
  for (const options of [
    { receipt: { fiscal_sign: null } },
    { intents: [{}, {}] },
    { copies: [{}, {}] },
    { insert: false }
  ]) {
    const harness = reconciliationWith(options);
    assert.equal(await harness.reconcile('receipt-1'), false);
  }
});

test('general manual reconciliation cannot bypass fiscal proof for POS intents', () => {
  const action = read('src/app/admin/integrations/evotor/reconciliation/actions.ts');
  assert.match(action, /POS_PROOF_REQUIRED/);
  assert.match(action, /intent\.fiscal_storage_number = imported\.fiscal_drive_number/);
  assert.match(action, /intent\.evotor_cloud_device_id = cloud\.evotor_device_id/);
  assert.match(action, /intent\.evotor_cloud_store_id = store\.evotor_store_id/);
});
