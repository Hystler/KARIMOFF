import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const activity = read('android/evotor-bridge/app/src/main/java/ru/karimoff/evotor/bridge/MainActivity.java');
const payments = read('src/lib/integrations/evotor/pos-payments.ts');
const migration = read('database/migrations/20261003120000_pos_fiscal_identity.sql');
const sync = read('src/lib/integrations/evotor/sync.ts');

function reconciliationWith({ receipt = {}, intents = [{}], copies = [{}], insert = true } = {}) {
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
    if (query.includes('select intent.id, intent.order_id')) return intents.map((item, index) => ({
      id: `intent-${index}`, order_id: `order-${index}`, payment_id: `payment-${index}`, ...item
    }));
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
  assert.match(method, /putString\(ACTIVE_RECEIPT_KEY, identity\.toString\(\)\)\.commit\(\)/);
  assert.match(method, /"\/receipt", token, body/);
  assert.ok(method.indexOf('putString(ACTIVE_RECEIPT_KEY') < method.indexOf('"/receipt", token, body'));
  assert.ok(method.indexOf('"/receipt", token, body') < method.indexOf('moveReceiptToCardPayment(job, token, performer)'));
  assert.match(method, /queuePaymentResult\(intentId, "failed"/);
  assert.doesNotMatch(method.slice(method.indexOf('catch (Throwable error) {')), /moveReceiptToCardPayment\(job, token, performer\)/);
});

test('successful callback uses saved UUID to read closed receipt and persists delayed recovery', () => {
  const success = activity.slice(activity.indexOf('public void onSuccess()'), activity.indexOf('public void onError('));
  assert.match(success, /activeReceipt\(\)/);
  assert.match(success, /identity\.put\("paymentConfirmed", true\)/);
  assert.doesNotMatch(success, /getReceipt\(MainActivity\.this, Receipt\.Type\.SELL\)/);
  assert.match(activity, /ReceiptApi\.getReceipt\(this, uuid\)/);
  assert.match(activity, /ReceiptApi\.getFiscalReceipts\(this, uuid\)/);
  assert.match(activity, /if \(!activeReceipt\(\)\.isEmpty\(\)\)/);
  assert.match(activity, /fiscalReadAttempts >= 12/);
  assert.match(activity, /retryPendingPaymentResult\(\);\s*schedulePaymentPoll\(1500\)/);
  assert.match(activity, /"fiscal_pending"\.equals\(finalStatus\)/);
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
  assert.match(payments, /where id = \$\{input\.terminalDeviceId\}::uuid/);
  assert.doesNotMatch(payments, /order by last_seen_at desc/);
  assert.match(payments, /Касса занята/);
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
  assert.match(sync, /await reconcileEvotorReceipt\(transaction, receiptRows\[0\]\.id\)/);
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
