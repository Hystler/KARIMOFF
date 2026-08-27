import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260827120000_add_yookassa_payment_integration.sql");
const fiscalRefinement = read("supabase/migrations/20260827143000_refine_yookassa_fiscal_operations.sql");
const analyticsMigration = read("supabase/migrations/20260812213000_add_unified_sales_analytics.sql");
const analyticsDashboard = read("src/lib/analytics/dashboard.ts");
const analyticsFilterBar = read("src/components/admin/analytics/AnalyticsFilterBar.tsx");
const analyticsQuery = read("src/lib/analytics/query.ts");
const analyticsSales = read("src/lib/analytics/sales.ts");
const clientSource = read("src/lib/payments/yookassa/client.ts");
const configSource = read("src/lib/payments/yookassa/config.ts");
const repository = read("src/lib/payments/yookassa/repository.ts");
const service = read("src/lib/payments/yookassa/service.ts");
const webhookRoute = read("src/app/api/webhooks/yookassa/route.ts");
const returnStatus = read("src/components/payments/PaymentReturnStatus.tsx");
const checkoutAction = read("src/app/actions/orders.ts");
const cartDrawer = read("src/components/cart/CartDrawer.tsx");
const adminAction = read("src/app/admin/orders/actions.ts");
const adminPage = read("src/app/admin/orders/page.tsx");
const instrumentation = read("src/instrumentation.ts");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");

function fixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-yookassa-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');

  for (const name of ["types", "errors", "money", "receipt", "retry", "client"]) {
    let source = read(`src/lib/payments/yookassa/${name}.ts`)
      .replace('import "server-only";\n\n', "")
      .replace(/from "\.\/(types|errors|money|config)"/g, 'from "./$1.ts"');
    writeFileSync(join(directory, `${name}.ts`), source);
  }
  writeFileSync(
    join(directory, "config.ts"),
    'export type YooKassaConfiguration = { baseUrl: "https://api.yookassa.ru/v3"; returnUrl: string; secretKey: string; shopId: string; webhookUrl: string };\n'
  );
  writeFileSync(
    join(directory, "runtime-config.ts"),
    read("src/lib/payments/yookassa/config.ts")
      .replace('import "server-only";\n\n', "")
      .replace('from "./errors"', 'from "./errors.ts"')
  );

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    url: (name) => pathToFileURL(join(directory, `${name}.ts`)).href
  };
}

function runTypeScript(source) {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    source
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("money and receipts use exact minor units and official YooKassa fiscal values", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const money = await import(${JSON.stringify(subject.url("money"))});
      const receipt = await import(${JSON.stringify(subject.url("receipt"))});
      const items = [{
        productName: "Бургер Тайсон",
        quantity: 2,
        unitPrice: "325.50",
        lineTotal: "651.00",
        modifiers: [
          { modifierType: "remove", ingredientName: "Лук" },
          { modifierType: "add", ingredientName: "Сыр" }
        ]
      }];
      const payment = receipt.buildPaymentReceipt({ email: " GUEST@EXAMPLE.RU ", expectedTotal: "651.00", items });
      const settlement = receipt.buildPrepaymentSettlementReceipt({
        email: "guest@example.ru",
        expectedTotal: "651.00",
        items,
        paymentId: "provider-payment"
      });
      const partialRefund = receipt.buildPartialRefundReceipt({
        email: "guest@example.ru",
        expectedTotal: "651.00",
        items
      });
      console.log(JSON.stringify({
        exact: money.minorUnitsToMoney(money.moneyToMinorUnits("90071992547409.91")),
        payment,
        settlement,
        partialRefund
      }));
    `);
  } finally {
    subject.cleanup();
  }

  assert.equal(result.exact, "90071992547409.91");
  assert.equal(result.payment.customer.email, "guest@example.ru");
  assert.equal(result.payment.items[0].vat_code, 1);
  assert.equal(result.payment.items[0].payment_subject, "commodity");
  assert.equal(result.payment.items[0].payment_mode, "full_prepayment");
  assert.equal(result.payment.items[0].measure, "piece");
  assert.equal(result.payment.internet, true);
  assert.equal("timezone" in result.payment, false);
  assert.match(result.payment.items[0].description, /без Лук/);
  assert.match(result.payment.items[0].description, /\+ Сыр/);
  assert.equal(result.settlement.items[0].payment_mode, "full_payment");
  assert.deepEqual(result.settlement.settlements, [{
    type: "prepayment",
    amount: { value: "651.00", currency: "RUB" }
  }]);
  assert.equal(result.partialRefund.items[0].payment_mode, "full_prepayment");
});

test("receipt validation rejects missing contact, invalid item count, malformed totals, and money", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const receipt = await import(${JSON.stringify(subject.url("receipt"))});
      const money = await import(${JSON.stringify(subject.url("money"))});
      const capture = (callback) => { try { callback(); return null; } catch (error) { return error.message; } };
      const item = { productName: "Шаурма", quantity: 1, unitPrice: "300.00", lineTotal: "300.00" };
      const tooManyItems = Array.from({ length: 81 }, () => ({ ...item }));
      console.log(JSON.stringify({
        email: capture(() => receipt.buildPaymentReceipt({ email: "", expectedTotal: "300.00", items: [item] })),
        itemCount: capture(() => receipt.buildPaymentReceipt({ email: "a@b.ru", expectedTotal: "24300.00", items: tooManyItems })),
        itemAmount: capture(() => receipt.buildPaymentReceipt({ email: "a@b.ru", expectedTotal: "0.00", items: [{ ...item, unitPrice: "0.00", lineTotal: "0.00" }] })),
        line: capture(() => receipt.buildPaymentReceipt({ email: "a@b.ru", expectedTotal: "300.00", items: [{ ...item, lineTotal: "299.00" }] })),
        total: capture(() => receipt.buildPaymentReceipt({ email: "a@b.ru", expectedTotal: "301.00", items: [item] })),
        float: capture(() => money.moneyToMinorUnits("0.001"))
      }));
    `);
  } finally {
    subject.cleanup();
  }
  assert.deepEqual(result, {
    email: "INVALID_RECEIPT_EMAIL",
    itemCount: "INVALID_RECEIPT_ITEM_COUNT",
    itemAmount: "INVALID_RECEIPT_ITEM_AMOUNT",
    line: "RECEIPT_LINE_TOTAL_MISMATCH",
    total: "RECEIPT_TOTAL_MISMATCH",
    float: "INVALID_MONEY_VALUE"
  });
});

test("YooKassa POST retries preserve the exact body and Idempotence-Key", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const { YooKassaClient } = await import(${JSON.stringify(subject.url("client"))});
      const calls = [];
      const fetchImpl = async (url, options) => {
        calls.push({ url, body: options.body, key: options.headers["Idempotence-Key"], auth: options.headers.Authorization });
        if (calls.length < 3) return new Response(JSON.stringify({ code: "internal_server_error" }), { status: 500 });
        return new Response(JSON.stringify({ id: "p-1", status: "pending", paid: false, amount: { value: "100.00", currency: "RUB" } }), { status: 200 });
      };
      const client = new YooKassaClient({
        baseUrl: "https://api.yookassa.ru/v3",
        shopId: "test-shop",
        secretKey: "test-secret",
        returnUrl: "https://example.test/checkout/payment/return",
        webhookUrl: "https://example.test/api/webhooks/yookassa"
      }, { fetchImpl, sleep: async () => {}, random: () => 0.5 });
      await client.createPayment({ amount: { value: "100.00", currency: "RUB" } }, "11111111-1111-4111-8111-111111111111");
      console.log(JSON.stringify({ calls: calls.map(({ url, body, key, auth }) => ({ url, body, key, basic: auth.startsWith("Basic ") })) }));
    `);
  } finally {
    subject.cleanup();
  }
  assert.equal(result.calls.length, 3);
  assert.equal(new Set(result.calls.map((call) => call.key)).size, 1);
  assert.equal(new Set(result.calls.map((call) => call.body)).size, 1);
  assert.ok(result.calls.every((call) => call.basic));
  assert.ok(result.calls.every((call) => call.url === "https://api.yookassa.ru/v3/payments"));
});

test("YooKassa client classifies 400, 401, 429, 5xx, and timeouts safely", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const { YooKassaClient } = await import(${JSON.stringify(subject.url("client"))});
      const configuration = {
        baseUrl: "https://api.yookassa.ru/v3",
        shopId: "shop",
        secretKey: "test-secret",
        returnUrl: "https://example.test/checkout/payment/return",
        webhookUrl: "https://example.test/api/webhooks/yookassa"
      };
      async function status(status) {
        let calls = 0;
        const client = new YooKassaClient(configuration, {
          fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ code: "safe_code" }), { status }); },
          sleep: async () => {},
          random: () => 0.5
        });
        try { await client.getPayment("p-1"); } catch (error) {
          return { calls, kind: error.kind, retryable: error.retryable, status: error.status, message: error.message };
        }
      }
      let timeoutCalls = 0;
      const timeoutClient = new YooKassaClient(configuration, {
        timeoutMs: 1,
        sleep: async () => {},
        random: () => 0.5,
        fetchImpl: async (_url, options) => {
          timeoutCalls += 1;
          return await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
            const error = new Error("aborted"); error.name = "AbortError"; reject(error);
          }, { once: true }));
        }
      });
      let timeout;
      try { await timeoutClient.getPayment("p-1"); } catch (error) {
        timeout = { calls: timeoutCalls, code: error.providerCode, message: error.message };
      }
      console.log(JSON.stringify({
        bad: await status(400),
        unauthorized: await status(401),
        limited: await status(429),
        provider: await status(503),
        timeout
      }));
    `);
  } finally {
    subject.cleanup();
  }
  assert.deepEqual(
    [result.bad.calls, result.unauthorized.calls, result.limited.calls, result.provider.calls],
    [1, 1, 3, 3]
  );
  assert.equal(result.unauthorized.kind, "authentication");
  assert.equal(result.unauthorized.retryable, false);
  assert.equal(result.limited.retryable, true);
  assert.equal(result.provider.retryable, true);
  assert.equal(result.timeout.calls, 3);
  assert.equal(result.timeout.code, "TIMEOUT");
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});

test("reconciliation backoff follows the bounded schedule and stops after 24 hours", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const retry = await import(${JSON.stringify(subject.url("retry"))});
      console.log(JSON.stringify({
        normal: [0, 121, 601, 3601].map((age) => retry.yooKassaReconciliationDelaySeconds({ ageSeconds: age, attempts: 0 })),
        transient: [1, 2, 3, 4, 8].map((attempts) => retry.yooKassaReconciliationDelaySeconds({ ageSeconds: 0, attempts, transientFailure: true, random: 1 })),
        expired: retry.yooKassaReconciliationDelaySeconds({ ageSeconds: 86400, attempts: 1 })
      }));
    `);
  } finally {
    subject.cleanup();
  }
  assert.deepEqual(result.normal, [10, 30, 120, 900]);
  assert.deepEqual(result.transient, [12, 24, 48, 96, 900]);
  assert.equal(result.expired, null);
});

test("checkout is server-priced, atomic, disabled by default, and double-click safe", () => {
  assert.match(checkoutAction, /if \(!isYooKassaCheckoutEnabled\(\)\)/);
  assert.match(checkoutAction, /createOrder\([\s\S]+requiresPayment: true/);
  assert.match(checkoutAction, /createYooKassaPaymentForOrder\(order\.paymentId\)/);
  assert.doesNotMatch(checkoutAction, /amount:\s*(formData|parsed)/);
  assert.match(cartDrawer, /name="idempotency_key" value=\{checkoutRequestId\}/);
  assert.match(cartDrawer, /setCheckoutRequestId\(crypto\.randomUUID\(\)\)/);
  assert.match(migration, /create_site_order_with_payment[\s\S]+from public\.create_site_order/);
  assert.match(migration, /payments_yookassa_order_key/);
  assert.match(migration, /where idempotency_key = p_payment_idempotency_key[\s\S]+for update/);
  assert.match(migration, /v_payment\.amount <> v_order\.total/);
});

test("webhook accepts only official events and verifies the provider object by GET", () => {
  for (const event of [
    "payment.waiting_for_capture",
    "payment.succeeded",
    "payment.canceled",
    "refund.succeeded"
  ]) assert.ok(service.includes(`"${event}"`));
  assert.doesNotMatch(service, /refund\.canceled/);
  assert.match(service, /client\.getPayment\(params\.objectId\)/);
  assert.match(service, /client\.getRefund\(params\.objectId\)/);
  assert.match(service, /assertPaymentBinding\(context, payment\)/);
  assert.match(service, /assertRefundBinding\(context, refund\)/);
  assert.match(service, /PAYMENT_AMOUNT_MISMATCH/);
  assert.match(service, /PAYMENT_METADATA_MISMATCH/);
  assert.match(repository, /on conflict \(provider, provider_event_id\)/);
  assert.match(service, /if \(eventRow\?\.processed_at\) return \{ duplicate: true \}/);
  assert.match(webhookRoute, /payload_too_large/);
  assert.match(webhookRoute, /z\.literal\("notification"\)/);
  assert.match(webhookRoute, /provider_verification_failed/);
  assert.match(webhookRoute, /error\.kind === "validation"/);
  assert.match(service, /error\.kind === "validation"[\s\S]+processed: permanentlyRejected/);
  assert.doesNotMatch(webhookRoute, /parsed\.data\.object\.(amount|paid|status)/);
});

test("payment success opens KDS once while pending and duplicate events remain non-operational", () => {
  assert.match(migration, /source_metadata[\s\S]+'payment_required', true/);
  assert.match(migration, /is_operational = v_payment\.status in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.match(migration, /enforce_online_payment_kitchen_guard/);
  assert.match(migration, /new\.payment_status not in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.match(migration, /'order\.payment_succeeded'[\s\S]+on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /'order:' \|\| v_order\.id::text \|\| ':payment:succeeded'/);
  assert.doesNotMatch(webhookRoute, /kitchen_status/);
});

test("return page never trusts the provider redirect and does not auto-create another payment", () => {
  assert.match(returnStatus, /Проверяем оплату/);
  assert.match(returnStatus, /Платёж ещё проверяется/);
  assert.match(returnStatus, /Новый платёж автоматически не создаётся/);
  assert.match(returnStatus, /\/api\/payments\/\$\{encodeURIComponent\(props\.paymentId\)\}\/status/);
  assert.doesNotMatch(returnStatus, /payment\.succeeded|query.*paid/i);
  assert.match(returnStatus, /visibilitychange/);
  assert.match(returnStatus, /pageshow/);
});

test("reconciliation claims rows with leases and never rewinds order or payment cursors", () => {
  assert.match(repository, /for update skip locked/);
  assert.match(repository, /reconcile_locked_at < now\(\) - interval '2 minutes'/);
  assert.match(repository, /status = 'pending' or receipt_registration = 'pending'/);
  assert.match(instrumentation, /startYooKassaBackgroundScheduler/);
  assert.match(service, /runYooKassaReconciliationBatch/);
  assert.match(service, /executeYooKassaPaymentForOrder\(context\.id, clientFactory\)/);
  assert.match(repository, /next_reconcile_at = \$\{nextAt\}/);
  assert.doesNotMatch(service, /high.water|cursor/i);
});

test("refund architecture supports exact full and partial idempotent refunds without public UI", () => {
  assert.match(repository, /REFUND_AMOUNT_EXCEEDS_AVAILABLE/);
  assert.match(repository, /PARTIAL_REFUND_ITEMS_REQUIRED/);
  assert.match(repository, /REFUND_ITEMS_TOTAL_MISMATCH/);
  assert.match(repository, /REFUND_REASON_REQUIRED/);
  assert.match(repository, /REFUND_ACTOR_NOT_AUTHORIZED/);
  assert.match(repository, /role in \('owner', 'admin'\)/);
  assert.match(repository, /where idempotency_key = \$\{params\.idempotencyKey\}[\s\S]+for update/);
  assert.match(repository, /pending_amount/);
  assert.match(repository, /payment\.refundable_amount[\s\S]+reserved\?\.pending_amount/);
  assert.match(service, /!context\.isFullRefund[\s\S]+buildPartialRefundReceipt/);
  assert.match(repository, /PARTIAL_REFUND_AFTER_HANDOFF_UNSUPPORTED/);
  assert.doesNotMatch(service, /handedOut:\s*context\.handedOut/);
  assert.match(service, /context\.providerRefundId[\s\S]+getRefund/);
  assert.match(migration, /apply_yookassa_refund_state/);
  assert.match(migration, /update public\.payments[\s\S]+set status = 'paid'/);
  assert.match(analyticsMigration, /payment\.status = 'paid'/);
  assert.match(migration, /refunds_yookassa_actor_check/);
  assert.match(migration, /refunds_yookassa_reason_check/);
  assert.match(migration, /'order\.payment_refunded'[\s\S]+on conflict \(idempotency_key\) do nothing/);
  assert.doesNotMatch(adminPage, /Создать возврат|Оформить возврат/);
});

test("fiscal state is independent and prepayment settlement is queued only on handout", () => {
  assert.match(migration, /receipt_registration/);
  assert.match(migration, /refresh_yookassa_order_fiscal_status/);
  assert.match(migration, /queue_yookassa_prepayment_settlement/);
  assert.match(migration, /new\.kitchen_status <> 'handed_out'/);
  assert.doesNotMatch(migration, /new\.kitchen_status <> 'ready'/);
  assert.match(migration, /receipt_phase[\s\S]+'prepayment_settlement'/);
  assert.match(service, /buildPrepaymentSettlementReceipt/);
  assert.match(service, /bindFiscalReceiptRequestFingerprint/);
  assert.match(repository, /refund\.id = any\(\$\{includedRefundIds\}::uuid\[\]\)/);
  assert.match(repository, /payment\.receipt_registration = 'succeeded'/);
  assert.match(repository, /refund\.status = 'pending'/);
  assert.match(service, /context\.receiptRegistration !== "succeeded"/);
  assert.match(service, /releaseFiscalReceiptClaim/);
  assert.match(migration, /'included_refund_ids', v_completed_refund_ids/);
  assert.match(
    fiscalRefinement,
    /set amount = greatest\(payment\.amount - v_completed_refund, 0\)/
  );
  assert.match(fiscalRefinement, /request_fingerprint is null/);
  assert.match(adminPage, /Фискализация/);
  assert.match(adminPage, /Чек/);
});

test("paid YooKassa item composition and fiscal request bodies are immutable snapshots", () => {
  assert.match(fiscalRefinement, /add column if not exists receipt_snapshot jsonb/);
  assert.match(fiscalRefinement, /build_yookassa_order_receipt_snapshot/);
  assert.match(fiscalRefinement, /v_total is distinct from new\.amount/);
  assert.match(fiscalRefinement, /payments_yookassa_receipt_snapshot_immutable/);
  assert.match(fiscalRefinement, /payments_yookassa_request_immutable/);
  assert.match(fiscalRefinement, /order_items_paid_yookassa_immutable/);
  assert.match(fiscalRefinement, /order_item_modifiers_paid_yookassa_immutable/);
  assert.match(fiscalRefinement, /orders_yookassa_total_immutable/);
  assert.match(fiscalRefinement, /v_payment\.amount - v_completed_refund/);
  assert.match(fiscalRefinement, /receipt_snapshot is not null/);
  assert.match(repository, /parseReceiptSnapshot\(row\.receipt_snapshot\)/);
  assert.match(repository, /transaction\.json\(\{ request: receiptSnapshot \}\)/);
  assert.match(repository, /loadSettlementItems\(row\.order_id, includedRefundIds, paymentItems\)/);
});

test("receipt email is required for YooKassa and remembered only after successful payment", () => {
  assert.match(checkoutAction, /receipt_email/);
  assert.match(cartDrawer, /Email для чека/);
  assert.match(cartDrawer, /На эту почту придёт электронный чек/);
  assert.match(cartDrawer, /checkoutSettings\.online_payments_enabled/);
  assert.match(fiscalRefinement, /add column if not exists receipt_email text/);
  assert.match(fiscalRefinement, /new\.status not in \('paid', 'partially_refunded', 'refunded'\)/);
  assert.match(fiscalRefinement, /payments_remember_yookassa_receipt_email/);
});

test("YooKassa operational analytics stays canonical and provider-filtered", () => {
  assert.match(fiscalRefinement, /create or replace view public\.canonical_analytics_sales/);
  assert.match(fiscalRefinement, /end as payment_provider/);
  assert.match(analyticsQuery, /filters\.provider[\s\S]+payment_provider/);
  assert.match(analyticsFilterBar, /Платёжный провайдер/);
  assert.match(analyticsDashboard, /getPaymentOperations/);
  assert.match(analyticsDashboard, /getFiscalOperations/);
  assert.match(analyticsDashboard, /join public\.payments payment/);
  assert.match(analyticsDashboard, /join public\.fiscal_receipts receipt/);
  assert.doesNotMatch(analyticsDashboard, /payment_events/);
  assert.match(analyticsSales, /paymentProvider: row\.payment_provider/);
});

test("YooKassa sale and an explicitly reconciled late Evotor receipt count once", () => {
  assert.match(analyticsMigration, /analytics_sale_reconciliations/);
  assert.match(analyticsMigration, /where status = 'confirmed'/);
  assert.match(analyticsMigration, /where not exists \([\s\S]+link\.evotor_receipt_id = r\.id/);
  assert.match(analyticsMigration, /left join confirmed_links link on link\.web_order_id = o\.id/);
  assert.match(analyticsMigration, /match_method in \('external_reference', 'fiscal_reference', 'manual'\)/);
  assert.doesNotMatch(migration, /amount[\s\S]{0,120}closed_at[\s\S]{0,120}(auto|suggested)/i);
  assert.doesNotMatch(service, /evotor/i);
  assert.doesNotMatch(migration, /inventory_(movements|deduction)|stock_movements/);
  assert.doesNotMatch(fiscalRefinement, /inventory_(movements|deduction)|stock_movements/);
  assert.doesNotMatch(fiscalRefinement, /from public\.fiscal_receipts[\s\S]+net_revenue/);
  assert.match(migration, /'order:' \|\| v_order\.id::text \|\| ':payment:succeeded'/);
  assert.match(migration, /'yookassa:payment:' \|\| v_payment\.id::text \|\| ':settlement'/);
});

test("configuration is server-only, same-origin, and never exposes YooKassa credentials", () => {
  assert.match(configSource, /process\.env\.YOOKASSA_SHOP_ID/);
  assert.match(configSource, /process\.env\.YOOKASSA_SECRET_KEY/);
  assert.match(configSource, /url\.origin !== origin\.origin/);
  assert.match(configSource, /url\.search/);
  assert.match(configSource, /url\.hash/);
  assert.match(clientSource, /Authorization: `Basic/);
  assert.doesNotMatch(clientSource, /console\.(log|info|warn|error)/);

  const publicClientFiles = [cartDrawer, returnStatus];
  for (const source of publicClientFiles) {
    assert.doesNotMatch(source, /YOOKASSA_(SHOP_ID|SECRET_KEY)/);
    assert.doesNotMatch(source, /Authorization:\s*`?Basic/);
  }
});

test("checkout remains disabled until every server-side setting is valid", () => {
  const subject = fixture();
  let result;
  try {
    result = runTypeScript(`
      const config = await import(${JSON.stringify(subject.url("runtime-config"))});
      Object.assign(process.env, {
        NODE_ENV: "production",
        APP_ORIGIN: "https://karimoff.site",
        YOOKASSA_SHOP_ID: "shop",
        YOOKASSA_SECRET_KEY: "secret",
        YOOKASSA_WEBHOOK_URL: "https://karimoff.site/api/webhooks/yookassa",
        YOOKASSA_RETURN_URL: "https://karimoff.site/checkout/payment/return",
        TEST_ORDER_MODE: "false",
        PAYMENTS_ENABLED: "false"
      });
      const configured = Boolean(config.getYooKassaConfiguration());
      const disabled = config.isYooKassaCheckoutEnabled();
      process.env.PAYMENTS_ENABLED = "true";
      const enabled = config.isYooKassaCheckoutEnabled();
      process.env.YOOKASSA_RETURN_URL = "https://evil.example/checkout/payment/return";
      const externalReturn = config.isYooKassaCheckoutEnabled();
      process.env.YOOKASSA_RETURN_URL = "https://karimoff.site/checkout/payment/return?status=paid";
      const queryReturn = config.isYooKassaCheckoutEnabled();
      process.env.YOOKASSA_RETURN_URL = "https://karimoff.site/checkout/payment/return";
      process.env.TEST_ORDER_MODE = "true";
      const testMode = config.isYooKassaCheckoutEnabled();
      console.log(JSON.stringify({ configured, disabled, enabled, externalReturn, queryReturn, testMode }));
    `);
  } finally {
    subject.cleanup();
  }
  assert.deepEqual(result, {
    configured: true,
    disabled: false,
    enabled: true,
    externalReturn: false,
    queryReturn: false,
    testMode: false
  });
});

test("admin exposes a read-only verified status action and normalized payment data", () => {
  assert.match(adminAction, /checkYooKassaPaymentStatusAction/);
  assert.match(adminAction, /checkYooKassaPaymentStatusReadOnly/);
  assert.doesNotMatch(adminAction, /reconcileYooKassaPayment/);
  assert.match(service, /checkYooKassaPaymentStatusReadOnly[\s\S]+clientFactory\(configuration\)\.getPayment/);
  assert.match(service, /PROVIDER_PAYMENT_ID_MISSING/);
  assert.match(adminAction, /canStaffAccessOrder\(staff, orderId\)/);
  assert.match(adminAction, /payment\.orderId !== orderId/);
  assert.match(adminPage, /Проверить статус/);
  assert.match(adminPage, /ЮKassa/);
  assert.match(adminPage, /Payment ID/);
  assert.doesNotMatch(adminAction, /createYooKassaRefund/);
});

test("runtime migration is wired into image startup with postconditions", () => {
  assert.match(runtimeMigrations, /20260827120000_add_yookassa_payment_integration/);
  assert.match(runtimeMigrations, /payments_yookassa_reconcile_idx/);
  assert.match(runtimeMigrations, /payments_yookassa_provider_payment_key/);
  assert.match(runtimeMigrations, /payments_yookassa_order_key/);
  assert.match(runtimeMigrations, /create_site_order_with_payment/);
  assert.match(runtimeMigrations, /apply_yookassa_payment_state/);
  assert.match(dockerfile, /20260827120000_add_yookassa_payment_integration\.sql/);
  assert.match(dockerignore, /!supabase\/migrations\/20260827120000_add_yookassa_payment_integration\.sql/);
  assert.match(runtimeMigrations, /20260827143000_refine_yookassa_fiscal_operations/);
  assert.match(runtimeMigrations, /payment_receipt_snapshot/);
  assert.match(runtimeMigrations, /analytics_payment_provider/);
  assert.match(
    runtimeMigrations,
    /has_table_privilege\(\s*'karimoff_app',\s*to_regclass\('public\.' \|\| expected_table\.name\)/,
    "cold-start checks must handle payment tables that do not exist yet",
  );
  assert.match(dockerfile, /20260827143000_refine_yookassa_fiscal_operations\.sql/);
  assert.match(dockerignore, /!supabase\/migrations\/20260827143000_refine_yookassa_fiscal_operations\.sql/);
});
