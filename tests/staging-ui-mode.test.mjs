import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import * as zod from "zod";

async function withEnv(values, run) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function checkoutHarness({
  staging = true,
  deliveryFlag = "true",
  customer = { id: randomUUID(), name: "Обычный клиент", phone: "+79990000000", birthday: null },
  settings = { delivery_enabled: false, delivery_coverage_enabled: false, pickup_enabled: true },
  deliveryConfig = { enabled: false, center: [38.05, 55.90], radiusMeters: 3000,
    excludedAreas: [], deliveryFee: 200, freeThreshold: 2500, etaMinutes: 60,
    acceptanceStart: "11:00", acceptanceEnd: "20:30", timezone: "Europe/Moscow" },
  address = null,
  zoneAvailable = true,
  whitelistReady = true,
  consentState = null
} = {}) {
  const calls = { currentCustomer: 0, profileRead: 0, consentRead: 0, consentWrite: 0,
    order: 0, payment: 0, addressLookup: [], zonePoints: [] };
  const demo = { id: "staging-demo-customer", name: "Демо-покупатель", phone: "Не сохраняется", birthday: null };
  const schema = loadTypeScript("src/lib/order-schema.ts", { zod });
  const stagingHelper = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
  const imports = {
    "node:crypto": { randomUUID },
    "@/lib/customer-auth": { getCurrentCustomer: async () => { calls.currentCustomer += 1; return customer; } },
    "@/lib/database/server": { createDatabaseServerClient: () => {
      calls.profileRead += 1;
      throw new Error("Database profile reads must not run for the demo customer.");
    } },
    "@/lib/legal-consents": {
      getCurrentConsentState: async () => { calls.consentRead += 1; return consentState; },
      getShortUserAgent: async () => "synthetic",
      isChecked: value => value === "on",
      recordLegalConsents: async () => { calls.consentWrite += 1; return { ok: true }; }
    },
    "@/lib/legal": { LEGAL_VERSION: "test-version" },
    "@/lib/order-schema": schema,
    "@/lib/order-flow/service": { createOrder: async () => {
      calls.order += 1;
      return { orderId: randomUUID(), paymentId: randomUUID() };
    } },
    "@/lib/payments/yookassa/config": { isYooKassaCheckoutEnabled: () => true },
    "@/lib/payments/yookassa/errors": { safeYooKassaErrorCode: () => "PAYMENTS_DISABLED" },
    "@/lib/payments/yookassa/service": { createYooKassaPaymentForOrder: async () => {
      calls.payment += 1;
      return { confirmationUrl: "https://pay.invalid/confirmation" };
    } },
    "@/lib/order-time": { validateSameDayMoscowRequestedAt: () => ({ ok: true }) },
    "@/lib/settings": { getSiteSettings: async () => settings },
    "@/lib/delivery/geo": { assessDeliveryZone: ({ address: point }) => {
      calls.zonePoints.push(point);
      return { available: zoneAvailable };
    } },
    "@/lib/delivery/address-whitelist": {
      findDeliveryAddressById: async (id, locationId) => {
        calls.addressLookup.push({ id, locationId });
        return address;
      },
      getDefaultDeliveryLocationId: async () => "00000000-0000-4000-8000-000000000001",
      hasAvailableDeliveryAddresses: async () => whitelistReady,
      isAvailableDeliveryAddress: (row, id, locationId) => Boolean(row
        && row.id === id && row.location_id === locationId && row.is_available),
      listDeliveryHouses: async () => [],
      searchDeliveryStreets: async () => [],
      unavailableDeliveryAddressMessage: () => "По этому адресу доставка пока недоступна."
    },
    "@/lib/delivery/hours": { isDeliveryAcceptingAt: () => true },
    "@/lib/delivery/settings": { getDeliveryLocationSettings: async () => deliveryConfig },
    "@/lib/observability": { logOperationalError: () => { throw new Error("preview must not emit an operational write/log"); } },
    "@/lib/staging-ui-mode": stagingHelper
  };
  const api = loadTypeScript("src/app/actions/orders.ts", imports);
  const env = { STAGING_UI_MODE: staging ? "true" : "false", DELIVERY_ENABLED: deliveryFlag };
  return { api, calls, demo, run: fn => withEnv(env, fn) };
}

function orderForm({ deliveryType = "pickup", addressId = "", cart = [{ product_id: randomUUID(), quantity: 1 }] } = {}) {
  const form = new FormData();
  form.set("delivery_type", deliveryType);
  form.set("fulfillment_mode", "asap");
  form.set("delivery_address_id", addressId);
  form.set("cart", JSON.stringify(cart));
  form.set("comment", "synthetic UI preview");
  form.set("receipt_email", "demo-checkout@invalid.example");
  form.set("idempotency_key", randomUUID());
  return form;
}

test("STAGING_UI_MODE defaults off and does not change existing payment eligibility", async () => {
  await withEnv({ STAGING_UI_MODE: undefined, PAYMENTS_ENABLED: "true", TEST_ORDER_MODE: "false" }, () => {
    const helper = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
    assert.equal(helper.isStagingUiMode(), false);
    assert.equal(helper.isStagingDeliveryUiEnabled(), false);
  });
});

test("Postgres application pool requests read-only transactions only in staging UI mode", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalMode = process.env.STAGING_UI_MODE;
  const captures = [];
  const factory = (_url, options) => {
    captures.push(options);
    return { marker: captures.length };
  };
  try {
    process.env.DATABASE_URL = "postgres://readonly-test.invalid/app";
    process.env.STAGING_UI_MODE = "true";
    const staging = loadTypeScript("src/lib/postgres/server.ts", {
      "server-only": {},
      postgres: factory
    });
    staging.getPostgresSql();
    assert.equal(captures[0].connection.default_transaction_read_only, true);
    assert.equal(captures[0].connection.application_name, "karimoff-staging-ui-readonly");

    process.env.STAGING_UI_MODE = "false";
    const production = loadTypeScript("src/lib/postgres/server.ts", {
      "server-only": {},
      postgres: factory
    });
    production.getPostgresSql();
    assert.equal(captures[1].connection, undefined);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalMode === undefined) delete process.env.STAGING_UI_MODE;
    else process.env.STAGING_UI_MODE = originalMode;
  }
});

test("demo customer opens checkout without customer/session/consent reads and payments stay off", async () => {
  const h = checkoutHarness({ staging: true });
  const context = await h.run(() => h.api.getCheckoutContextAction());
  assert.equal(context.stagingUiMode, true);
  assert.deepEqual(context.customer, h.demo);
  assert.equal(context.payment.enabled, false);
  assert.equal(h.calls.currentCustomer, 0);
  assert.equal(h.calls.profileRead, 0);
  assert.equal(h.calls.consentRead, 0);
});

test("delivery UI override ignores shared availability flags but still requires configured whitelist data", async () => {
  const enabled = checkoutHarness({ staging: true, deliveryFlag: "true", whitelistReady: true });
  const enabledContext = await enabled.run(() => enabled.api.getCheckoutContextAction());
  assert.equal(enabledContext.settings.delivery_enabled, true);
  assert.equal(enabledContext.settings.delivery_fee, 200);
  assert.equal(enabledContext.settings.free_delivery_threshold, 2500);
  assert.equal(enabledContext.settings.delivery_eta_minutes, 60);
  assert.equal(enabledContext.settings.delivery_acceptance_start, "11:00");
  assert.equal(enabledContext.settings.delivery_acceptance_end, "20:30");

  const noWhitelist = checkoutHarness({ staging: true, deliveryFlag: "true", whitelistReady: false });
  const noWhitelistContext = await noWhitelist.run(() => noWhitelist.api.getCheckoutContextAction());
  assert.equal(noWhitelistContext.settings.delivery_enabled, false);

  const envOff = checkoutHarness({ staging: true, deliveryFlag: "false", whitelistReady: true });
  const envOffContext = await envOff.run(() => envOff.api.getCheckoutContextAction());
  assert.equal(envOffContext.settings.delivery_enabled, false);

  const production = checkoutHarness({ staging: false, deliveryFlag: "true", whitelistReady: true,
    settings: { delivery_enabled: false, delivery_coverage_enabled: false, pickup_enabled: true },
    customer: null });
  const productionContext = await production.run(() => production.api.getCheckoutContextAction());
  assert.equal(productionContext.stagingUiMode, false);
  assert.equal(productionContext.settings.delivery_enabled, false);
  assert.equal(production.calls.currentCustomer, 1);

  const productionEnvOff = checkoutHarness({
    staging: false,
    deliveryFlag: "false",
    settings: { delivery_enabled: true, delivery_coverage_enabled: true, pickup_enabled: true },
    deliveryConfig: { enabled: false, center: [38.05, 55.90], radiusMeters: 3000,
      excludedAreas: [], deliveryFee: 200, freeThreshold: 2500, etaMinutes: 60,
      acceptanceStart: "11:00", acceptanceEnd: "20:30", timezone: "Europe/Moscow" },
    customer: null
  });
  const productionEnvOffContext = await productionEnvOff.run(() => productionEnvOff.api.getCheckoutContextAction());
  assert.equal(productionEnvOffContext.settings.delivery_enabled, false);
});

test("production checkout keeps its existing order and payment path", async () => {
  const h = checkoutHarness({
    staging: false,
    settings: { delivery_enabled: true, delivery_coverage_enabled: true, pickup_enabled: true },
    customer: { id: randomUUID(), name: "Клиент", phone: "+79990000000", birthday: null },
    consentState: { document_version: "test-version" }
  });
  const result = await h.run(() => h.api.createOrderAction(undefined, orderForm()));
  assert.equal(result.status, "success");
  assert.ok(result.orderId);
  assert.equal(h.calls.order, 1);
  assert.equal(h.calls.payment, 1);
});

test("staging pickup submit returns preview before consent, order, event, or provider writes", async () => {
  const h = checkoutHarness({ staging: true });
  const result = await h.run(() => h.api.createOrderAction(undefined, orderForm()));
  assert.equal(result.status, "success");
  assert.equal(result.stagingPreview, true);
  assert.match(result.message, /Заказ и платёж не создавались/);
  assert.equal(h.calls.currentCustomer, 0);
  assert.equal(h.calls.profileRead, 0);
  assert.equal(h.calls.consentRead, 0);
  assert.equal(h.calls.consentWrite, 0);
  assert.equal(h.calls.order, 0);
  assert.equal(h.calls.payment, 0);
});

test("staging delivery preview validates address availability and server coordinates", async () => {
  const locationId = "00000000-0000-4000-8000-000000000001";
  const addressId = randomUUID();
  const validAddress = { id: addressId, location_id: locationId, is_available: true,
    longitude: 38.05, latitude: 55.90 };
  const valid = checkoutHarness({ staging: true, address: validAddress });
  const result = await valid.run(() => valid.api.createOrderAction(undefined,
    orderForm({ deliveryType: "delivery", addressId })));
  assert.equal(result.stagingPreview, true);
  assert.deepEqual(valid.calls.zonePoints[0], [38.05, 55.90]);
  assert.equal(valid.calls.order, 0);
  assert.equal(valid.calls.payment, 0);

  for (const rejectedAddress of [null, { ...validAddress, is_available: false },
    { ...validAddress, location_id: randomUUID() }]) {
    const rejected = checkoutHarness({ staging: true, address: rejectedAddress });
    const failure = await rejected.run(() => rejected.api.createOrderAction(undefined,
      orderForm({ deliveryType: "delivery", addressId })));
    assert.equal(failure.status, "error");
    assert.equal(rejected.calls.order, 0);
    assert.equal(rejected.calls.payment, 0);
  }

  const outside = checkoutHarness({ staging: true, address: validAddress, zoneAvailable: false });
  const outsideFailure = await outside.run(() => outside.api.createOrderAction(undefined,
    orderForm({ deliveryType: "delivery", addressId })));
  assert.equal(outsideFailure.status, "error");
  assert.equal(outside.calls.order, 0);
});

test("forged address coordinates are ignored; only the server-resolved whitelist record is checked", async () => {
  const locationId = "00000000-0000-4000-8000-000000000001";
  const addressId = randomUUID();
  const address = { id: addressId, location_id: locationId, is_available: true,
    longitude: 38.05, latitude: 55.90 };
  const h = checkoutHarness({ staging: true, address });
  const form = orderForm({ deliveryType: "delivery", addressId });
  form.set("latitude", "0");
  form.set("longitude", "0");
  const result = await h.run(() => h.api.createOrderAction(undefined, form));
  assert.equal(result.stagingPreview, true);
  assert.deepEqual(h.calls.zonePoints, [[38.05, 55.90]]);
  assert.deepEqual(h.calls.addressLookup, [{ id: addressId, locationId }]);
});

test("cookie preference in staging is acknowledged as browser-local without DB reads or writes", async () => {
  const helper = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
  const { POST } = loadTypeScript("src/app/api/cookie-consent/route.ts", {
    "@/lib/customer-auth": { getCurrentCustomer: async () => { throw new Error("must not read customer"); } },
    "@/lib/legal": { LEGAL_VERSION: "test" },
    "@/lib/request-security": { isAllowedSameOriginRequest: () => true },
    "@/lib/postgres/server": { getPostgresSql: () => { throw new Error("must not connect for a write"); } },
    "@/lib/staging-ui-mode": helper,
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }) } }
  });
  await withEnv({ STAGING_UI_MODE: "true" }, async () => {
    const response = await POST(new Request("https://stage.invalid/api/cookie-consent", { method: "POST" }));
    assert.deepEqual(response.body, { ok: true, stored: false, localOnly: true });
  });
});

test("YooKassa credentials cannot enable provider operations in staging UI mode", async () => {
  const source = loadTypeScript("src/lib/payments/yookassa/config.ts", {
    "server-only": {},
    "@/lib/staging-ui-mode": { isStagingUiMode: () => process.env.STAGING_UI_MODE === "true" },
    "./errors": { YooKassaError: class YooKassaError extends Error {} }
  });
  await withEnv({ STAGING_UI_MODE: "true", PAYMENTS_ENABLED: "true", TEST_ORDER_MODE: "false",
    YOOKASSA_SHOP_ID: "synthetic-shop", YOOKASSA_SECRET_KEY: "synthetic-secret",
    APP_ORIGIN: "https://stage.invalid", YOOKASSA_RETURN_URL: "https://stage.invalid/checkout/payment/return",
    YOOKASSA_WEBHOOK_URL: "https://stage.invalid/api/webhooks/yookassa" }, () => {
    assert.ok(source.getYooKassaConfiguration(), "credentials may be present, but stage operations must remain disabled");
    assert.equal(source.isYooKassaCheckoutEnabled(), false);
    assert.equal(source.isYooKassaReconciliationEnabled(), false);
  });
});

test("staging proxy blocks direct auth and provider/terminal API traffic", async () => {
  const { proxy } = loadTypeScript("src/proxy.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
        next: () => ({ status: 200 })
      }
    },
    "@/lib/maintenance": {
      isMaintenanceMode: () => false,
      isReadOnlyRequest: method => ["GET", "HEAD", "OPTIONS"].includes(method),
      MAINTENANCE_MESSAGE: "maintenance"
    },
    "@/lib/security/opaque-staff-login-origin": { getOpaqueStaffLoginOriginHeaders: () => null }
  });
  await withEnv({ STAGING_UI_MODE: "true" }, () => {
    for (const pathname of ["/api/auth/social/max/start", "/api/webhooks/yookassa",
      "/api/internal/evotor/sync", "/api/terminal/payments/next", "/api/pos/payments/00000000-0000-4000-8000-000000000000/status"]) {
      const response = proxy({ nextUrl: { pathname }, method: "POST", headers: new Headers() });
      assert.equal(response.status, 503, pathname);
    }
  });
});

test("staging blocks staff, kitchen, POS, and API mutations before their handlers", async () => {
  const { proxy } = loadTypeScript("src/proxy.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
        next: () => ({ status: 200 })
      }
    },
    "@/lib/maintenance": {
      isMaintenanceMode: () => false,
      isReadOnlyRequest: method => ["GET", "HEAD", "OPTIONS"].includes(method),
      MAINTENANCE_MESSAGE: "maintenance"
    },
    "@/lib/security/opaque-staff-login-origin": { getOpaqueStaffLoginOriginHeaders: () => null }
  });

  await withEnv({ STAGING_UI_MODE: "true" }, () => {
    for (const pathname of ["/admin/orders", "/kitchen", "/pos", "/api/admin/products", "/api/customer/orders"]) {
      const response = proxy({ nextUrl: { pathname }, method: "POST", headers: new Headers() });
      assert.equal(response.status, 503, pathname);
    }
    assert.equal(proxy({ nextUrl: { pathname: "/menu" }, method: "GET", headers: new Headers() }).status, 200);
    assert.equal(proxy({ nextUrl: { pathname: "/api/cookie-consent" }, method: "POST", headers: new Headers() }).status, 200);
  });
});

test("staging lead form exits before parsing or opening the database", async () => {
  let databaseCalls = 0;
  const helper = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
  const leadActions = loadTypeScript("src/app/actions/leads.ts", {
    "@/lib/lead-schema": { leadFormSchema: { safeParse: () => { throw new Error("must return before validation"); } } },
    "@/lib/legal-consents": { getShortUserAgent: async () => "", isChecked: () => false },
    "@/lib/phone": { normalizeRussianPhone: value => value },
    "@/lib/database/server": { createDatabaseServerClient: () => { databaseCalls += 1; throw new Error("must not connect"); } },
    "@/lib/legal": { LEGAL_VERSION: "test" },
    "@/lib/staging-ui-mode": helper
  });

  await withEnv({ STAGING_UI_MODE: "true" }, async () => {
    const result = await leadActions.createLeadAction({}, new FormData());
    assert.equal(result.status, "error");
    assert.match(result.message, /отключена в тестовом режиме/i);
    assert.equal(databaseCalls, 0);
  });
});

test("provider routes fail closed before rate-limit, database, or provider calls in staging", async () => {
  const helper = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
  let calls = 0;
  const nextServer = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
  const webhook = loadTypeScript("src/app/api/webhooks/yookassa/route.ts", {
    "next/server": nextServer,
    zod,
    "@/lib/auth-rate-limit": {
      checkAuthRateLimit: async () => { calls += 1; throw new Error("rate limit must not run"); },
      recordAuthFailure: async () => { calls += 1; }
    },
    "@/lib/payments/yookassa/errors": {
      safeYooKassaErrorCode: () => "unused",
      YooKassaError: class YooKassaError extends Error {}
    },
    "@/lib/payments/yookassa/service": {
      isSupportedYooKassaWebhookEvent: () => true,
      processYooKassaWebhook: async () => { calls += 1; }
    },
    "@/lib/staging-ui-mode": helper
  });
  const evotorSync = loadTypeScript("src/app/api/internal/evotor/sync/route.ts", {
    "next/server": nextServer,
    "next/cache": { revalidateTag: () => { calls += 1; } },
    zod,
    "@/lib/integrations/evotor/repository": { queueDueEvotorSyncs: async () => { calls += 1; } },
    "@/lib/integrations/evotor/sync": { processPendingEvotorSyncEvents: async () => { calls += 1; } },
    "@/lib/security/internal-request": { verifyInternalBearer: () => { calls += 1; return true; } },
    "@/lib/staging-ui-mode": helper
  });

  await withEnv({ STAGING_UI_MODE: "true", EVOTOR_ENABLED: "true" }, async () => {
    const hookResponse = await webhook.POST(new Request("https://stage.invalid/api/webhooks/yookassa", {
      method: "POST", body: JSON.stringify({ event: "payment.succeeded", object: { id: "synthetic" }, type: "notification" })
    }));
    const syncResponse = await evotorSync.POST(new Request("https://stage.invalid/api/internal/evotor/sync", { method: "POST" }));
    assert.equal(hookResponse.status, 503);
    assert.equal(syncResponse.status, 503);
    assert.equal(calls, 0);
  });
});

test("staging source guards keep auth writes and background jobs disabled", () => {
  const auth = readFileSync("src/app/auth/actions.ts", "utf8");
  assert.equal((auth.match(/if \(isStagingUiMode\(\)\) return stagingAuthUnavailable\(\);/g) ?? []).length, 6);
  assert.match(readFileSync("src/instrumentation.ts", "utf8"), /if \(process\.env\.STAGING_UI_MODE === "true"\) return/);
  assert.match(readFileSync("src/lib/customer-auth.ts", "utf8"), /if \(isStagingUiMode\(\)\) return null;/);
  const drawer = readFileSync("src/components/cart/CartDrawer.tsx", "utf8");
  assert.match(drawer, /Тестовый режим\. Заказы и платежи не создаются\./);
  assert.match(drawer, /Проверить оформление/);
  assert.match(drawer, /orderState\.stagingPreview/);
  const proxy = readFileSync("src/proxy.ts", "utf8");
  for (const prefix of ["/api/auth", "/api/webhooks/yookassa", "/api/internal/evotor",
    "/api/integrations/evotor", "/api/terminal", "/api/pos"]) {
    assert.ok(proxy.includes(`"${prefix}"`), `missing staging block for ${prefix}`);
  }
  assert.match(proxy, /isStaffAction \|\| isApiWrite/);
  assert.match(readFileSync("src/app/actions/leads.ts", "utf8"), /if \(isStagingUiMode\(\)\)[\s\S]*?Отправка заявок отключена/);
  assert.match(readFileSync("src/lib/integrations/evotor/terminal-bridge.ts", "utf8"),
    /return !isStagingUiMode\(\)/);
  assert.match(readFileSync("src/app/login/social/complete/actions.ts", "utf8"),
    /if \(isStagingUiMode\(\)\) return/);
});

test("read-only SQL runbook grants no customer/order/payment/session reads or writes", () => {
  const runbook = readFileSync("docs/release/staging-ui-readonly-runbook.md", "utf8");
  assert.match(runbook, /default_transaction_read_only = on/);
  assert.match(runbook, /GRANT SELECT ON TABLE/);
  assert.match(runbook, /has_function_privilege\('karimoff_staging_ro', p\.oid, 'EXECUTE'\)/);
  assert.match(runbook, /has_sequence_privilege\('karimoff_staging_ro', c\.oid, 'USAGE,UPDATE'\)/);
  assert.match(runbook, /GRANT EXECUTE ON FUNCTION %I\.digest\(text,text\)/);
  assert.match(runbook, /pg_auth_members/);
  assert.doesNotMatch(runbook, /GRANT (?:ALL|INSERT|UPDATE|DELETE) ON/);
  assert.doesNotMatch(runbook, /public\.(?:customers|app_sessions|orders|payments|fiscal_receipts)\s*,?/);
  assert.doesNotMatch(runbook, /ALTER TABLE public\.[a-z_]+ ENABLE ROW LEVEL SECURITY/);
  assert.match(runbook, /delivery_whitelist_release_version/);
  const runner = readFileSync("scripts/apply-runtime-schema-migrations.mjs", "utf8");
  assert.match(runner, /if \(process\.env\.STAGING_UI_MODE === "true"\)[\s\S]*?to_regclass\('public\.user_identities'\)/);
});
