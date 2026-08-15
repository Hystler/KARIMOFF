import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260814120000_add_canonical_order_flow_kds.sql");
const legacyInventoryMigration = read("supabase/migrations/20260728083046_add_staff_kitchen_modifiers_scheduling_and_registers.sql");
const orderService = read("src/lib/order-flow/service.ts");
const orderAction = read("src/app/actions/orders.ts");
const posAction = read("src/app/pos/actions.ts");
const kitchenAction = read("src/app/kitchen/actions.ts");
const kitchen = read("src/components/operations/KitchenWorkspace.tsx");
const displayPage = read("src/app/display/page.tsx");
const realtimeRoute = read("src/app/api/order-events/route.ts");
const realtimeHook = read("src/hooks/useOrderRealtime.ts");
const reconciliationAction = read("src/app/admin/integrations/evotor/reconciliation/actions.ts");
const reconciliationPage = read("src/app/admin/integrations/evotor/reconciliation/page.tsx");
const kitchenSettingsAction = read("src/app/admin/kitchen/actions.ts");
const evotorSync = read("src/lib/integrations/evotor/sync.ts");
const evotorRepository = read("src/lib/integrations/evotor/repository.ts");
const evotorScheduler = read("src/lib/integrations/evotor/scheduler.ts");
const analyticsDashboard = read("src/lib/analytics/dashboard.ts");
const analyticsSales = read("src/lib/analytics/sales.ts");
const analyticsPermissions = read("src/lib/analytics/permissions.ts");

function orderFlowFixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-order-flow-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const name of ["types", "sla", "permissions"]) {
    const source = read(`src/lib/order-flow/${name}.ts`).replace(
      /from "\.\/(types|sla|permissions)"/g,
      'from "./$1.ts"'
    );
    writeFileSync(join(directory, `${name}.ts`), source);
  }
  return {
    url: (name) => pathToFileURL(join(directory, `${name}.ts`)).href,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
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

test("KDS SLA and role transitions remain deterministic", () => {
  const fixture = orderFlowFixture();
  let result;
  try {
    result = runTypeScript(`
      const sla = await import(${JSON.stringify(fixture.url("sla"))});
      const permissions = await import(${JSON.stringify(fixture.url("permissions"))});
      const settings = { warningSeconds: 300, criticalSeconds: 480, readyDisplaySeconds: 900, onlineRequiresPaid: true, posRequiresPaid: false, inventoryTrigger: "ready" };
      console.log(JSON.stringify({
        elapsed: sla.elapsedSeconds("2026-08-14T10:00:00Z", new Date("2026-08-14T10:08:01Z")),
        tones: [299, 300, 480].map((value) => sla.classifySla(value, settings)),
        cook: [
          permissions.canTransitionKitchen("cook", "new", "accepted"),
          permissions.canTransitionKitchen("cook", "ready", "handed_out")
        ],
        cashier: permissions.canTransitionKitchen("cashier", "ready", "handed_out"),
        managerCannotCancelReady: permissions.canTransitionKitchen("manager", "ready", "cancelled"),
        onlineVisibleUnpaid: permissions.isOrderVisibleToKitchen({ source: "web", paymentStatus: "unpaid" }, settings),
        testOnlineVisibleUnpaid: permissions.isOrderVisibleToKitchen({ source: "web", paymentStatus: "unpaid", isTest: true }, settings),
        posVisibleUnpaid: permissions.isOrderVisibleToKitchen({ source: "pos", paymentStatus: "unpaid" }, settings)
      }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.elapsed, 481);
  assert.deepEqual(result.tones, ["normal", "warning", "critical"]);
  assert.deepEqual(result.cook, [true, false]);
  assert.equal(result.cashier, true);
  assert.equal(result.managerCannotCancelReady, false);
  assert.equal(result.onlineVisibleUnpaid, false);
  assert.equal(result.testOnlineVisibleUnpaid, true);
  assert.equal(result.posVisibleUnpaid, true);
  assert.match(kitchenSettingsAction, /criticalMinutes > value\.warningMinutes/);
  assert.match(kitchenSettingsAction, /inventory_trigger[\s\S]+'ready'/);
});

test("daily A/B numbering is atomic, location-scoped, and date-scoped", () => {
  assert.match(migration, /primary key \(location_id, business_date, prefix\)/);
  assert.match(migration, /on conflict \(location_id, business_date, prefix\)[\s\S]+last_value = public\.order_number_counters\.last_value \+ 1/);
  assert.match(migration, /when v_source in \('web', 'mobile'\) then 'A'/);
  assert.match(migration, /when v_source in \('pos', 'kiosk'\) then 'B'/);
  assert.match(migration, /at time zone v_timezone/);
  assert.match(migration, /orders_location_display_number_key/);
});

test("web and POS use one server-priced order-item writer", () => {
  assert.match(orderService, /export async function createOrder/);
  assert.match(orderService, /create_site_order/);
  assert.match(orderService, /create_pos_order_atomic/);
  assert.match(migration, /create or replace function public\.populate_order_items_atomic/);
  assert.match(migration, /where id = v_product_id and is_active = true/);
  assert.match(migration, /v_line_unit_price := v_product\.price \+ v_extra_total/);
  assert.match(migration, /v_total := public\.populate_order_items_atomic\(v_order_id, p_items\)/g);
  assert.doesNotMatch(posAction, /unit_price|line_total|trusted_price/);
});

test("scheduled web and POS orders are restricted to the current Moscow day", () => {
  const siteOrderSql = migration.slice(migration.indexOf("create or replace function public.create_site_order"), migration.indexOf("create or replace function public.create_pos_order_atomic"));
  const posOrderSql = migration.slice(migration.indexOf("create or replace function public.create_pos_order_atomic"), migration.indexOf("create or replace function public.set_order_kitchen_status_atomic"));
  assert.match(siteOrderSql, /p_requested_at at time zone 'Europe\/Moscow'/);
  assert.match(posOrderSql, /p_requested_at at time zone 'Europe\/Moscow'/);
  assert.match(orderAction, /validateSameDayMoscowRequestedAt/);
  assert.match(migration, /p_requested_at < now\(\) \+ interval '15 minutes'/);
});

test("inventory deduction remains transactional and exactly once", () => {
  assert.match(migration, /from public\.orders[\s\S]+for update/);
  assert.match(migration, /if p_status = 'ready' then[\s\S]+set_order_status_staff_atomic/);
  assert.match(legacyInventoryMigration, /from public\.inventory_items ii[\s\S]+for update/);
  assert.match(legacyInventoryMigration, /insert into public\.order_inventory_deductions \(order_id, status\)/);
  assert.match(legacyInventoryMigration, /where coalesce\(ii\.current_quantity, 0\) < requirements\.required_quantity/);
  assert.match(migration, /Готовый заказ нельзя отменить без оформления возврата/);
  assert.match(migration, /v_table \|\| '_order_flow_app'/);
  assert.match(migration, /grant execute on function public\.set_order_status_staff_atomic/);
  assert.doesNotMatch(evotorSync, /inventory_items|inventory_movements|order_inventory_deductions/);
});

test("status history, outbox, and realtime delivery do not expose customer PII", () => {
  assert.match(migration, /create table if not exists public\.order_status_events/);
  assert.match(migration, /create table if not exists public\.order_outbox/);
  assert.match(migration, /pg_notify\('karimoff_order_events'/);
  assert.match(kitchenAction, /canStaffAccessOrder/);
  assert.match(realtimeRoute, /text\/event-stream/);
  assert.match(realtimeRoute, /JSON\.stringify\(\{ type: event\.event_type \}\)/);
  assert.doesNotMatch(realtimeRoute, /customer_phone|customer_name|address|comment/);
  assert.match(realtimeHook, /setInterval[\s\S]+30_000/);
  assert.match(realtimeHook, /window\.addEventListener\("online"/);
});

test("pickup display receives only explicitly public order fields", () => {
  for (const field of ["displayNumber", "kitchenStatus", "publicDisplayName", "publicAvatarSeed", "publicAvatar"]) {
    assert.match(displayPage, new RegExp(`${field}: order\\.${field}`));
  }
  assert.doesNotMatch(displayPage, /customerPhone|customer_phone|address: order|comment: order|total: order/);
  assert.match(migration, /regexp_replace\([\s\S]+\\s\+\.\*\$/);
});

test("Evotor sync has cursor overlap, retries, and rolling reconciliation", () => {
  assert.match(migration, /create table if not exists public\.evotor_sync_cursors/);
  assert.match(evotorSync, /cursor\.getTime\(\) - overlap \* 1000/);
  assert.match(evotorSync, /event\.retry_count < 4/);
  assert.match(evotorSync, /15 \* 2 \*\* event\.retry_count/);
  assert.match(evotorRepository, /new Date\(now\.getTime\(\) - 72 \* 60 \* 60 \* 1000\)/);
  assert.match(evotorScheduler, /EVOTOR_INCREMENTAL_INTERVAL_SECONDS/);
  assert.match(evotorScheduler, /EVOTOR_RECONCILIATION_INTERVAL_HOURS/);
  assert.match(evotorScheduler, /pendingModes: Set<SyncMode>/);
  assert.match(evotorScheduler, /pendingModes\.has\("reconciliation"\)/);
  assert.match(evotorScheduler, /scheduleSync\("reconciliation", state\)/);
  assert.match(evotorSync, /sourceHash/);
  assert.match(evotorSync, /sort\(\(left, right\) => left\.sourceKey\.localeCompare/);
});

test("canonical analytics suppresses only confirmed reconciliations", () => {
  assert.match(migration, /create or replace view public\.canonical_analytics_sales/);
  assert.match(analyticsDashboard, /public\.canonical_analytics_sales/);
  assert.match(analyticsSales, /public\.canonical_analytics_sales/);
  assert.match(read("supabase/migrations/20260812213000_add_unified_sales_analytics.sql"), /where status = 'confirmed'/);
  assert.doesNotMatch(migration, /same amount|similar time|lower\(.*product_name/);
});

test("manual receipt reconciliation is explicit, scoped, audited, and inventory-neutral", () => {
  assert.match(reconciliationAction, /from public\.staff_location_access/);
  assert.match(reconciliationAction, /order_location_id = \$\{order\.location_id\}::uuid/);
  assert.match(reconciliationAction, /match_method, confidence/);
  assert.match(reconciliationAction, /'confirmed', 'manual', 1/);
  assert.match(reconciliationAction, /sales\.reconciliation\.confirm/);
  assert.match(reconciliationPage, /не использует их для автоматического объединения/);
  assert.doesNotMatch(reconciliationAction, /inventory_items|inventory_movements|order_inventory_deductions/);
});

test("staff location scope fails closed and write flows honor maintenance mode", () => {
  assert.match(analyticsPermissions, /!\["owner", "admin", "manager"\]\.includes\(staff\.role\)/);
  assert.match(analyticsPermissions, /locationIds: \[\]/);
  assert.match(posAction, /MAINTENANCE_MODE === "true"/);
  assert.match(kitchenAction, /MAINTENANCE_MODE === "true"/);
  assert.match(orderAction, /MAINTENANCE_MODE === "true"/);
});

test("KDS presents modifiers and the shared recipe without duplicating inventory recipes", () => {
  assert.match(kitchen, /Изменения гостя/);
  assert.match(kitchen, /modifier\.ingredientId === line\.ingredientId/);
  assert.match(kitchen, /Техкарта не заполнена/);
  assert.match(kitchen, /line\.preparationTimeSeconds/);
  assert.match(migration, /alter table public\.product_ingredients add column if not exists preparation_step/);
  assert.doesNotMatch(migration, /create table if not exists public\.kitchen_recipes/);
});

test("the standalone container verifies the Order Flow migration before startup", () => {
  const dockerfile = read("Dockerfile");
  const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
  assert.match(dockerfile, /20260814120000_add_canonical_order_flow_kds\.sql/);
  assert.match(runtimeMigrations, /name: "20260814120000_add_canonical_order_flow_kds"/);
  assert.match(runtimeMigrations, /to_regclass\('public\.order_outbox'\)/);
  assert.match(runtimeMigrations, /to_regprocedure\('public\.create_pos_order_atomic/);
});
