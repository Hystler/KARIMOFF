import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("database/migrations/20260929150000_add_delivery_checkout_and_courier_status.sql");
const hardening = read("database/migrations/20260930120000_delivery_release_hardening.sql");
const checkout = read("src/app/actions/orders.ts");
const orderService = read("src/lib/order-flow/service.ts");
const kitchen = read("src/components/operations/KitchenWorkspace.tsx");
const adminOrders = read("src/app/admin/orders/page.tsx");
const repeatOrder = read("src/components/profile/RepeatOrderButton.tsx");
const orders = read("src/lib/orders.ts");
const erp = read("src/lib/erp.ts");
const kitchenQueries = read("src/lib/order-flow/queries.ts");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const fiscalMigration = read("database/migrations/20260827143000_refine_yookassa_fiscal_operations.sql");

test("delivery is guarded by server configuration and charges only below the free threshold", () => {
  assert.match(checkout, /delivery_enabled: settings\.delivery_enabled && settings\.delivery_coverage_enabled/);
  assert.match(checkout, /delivery_type === "delivery" && !settings\.delivery_coverage_enabled/);
  assert.match(migration, /settings\.delivery_coverage_enabled[\s\S]+Доставка временно недоступна/);
  assert.match(migration, /v_subtotal < 2500 then 200/);
  assert.match(migration, /item\.item_type = 'delivery_fee'[\s\S]+item\.item_type = 'food'/);
  assert.match(runtimeMigrations, /name: "20260929150000_add_delivery_checkout_and_courier_status"/);
  assert.match(runtimeMigrations, /name: "20260930120000_delivery_release_hardening"/);
  assert.match(checkout, /const resolved = await resolveDeliveryAddress\(parsed\.data\.delivery_street/);
  assert.match(checkout, /address: geocoded\.coordinates/);
  assert.match(checkout, /latitude: resolved\.geocoded\.coordinates\[1\]/);
  assert.match(checkout, /longitude: resolved\.geocoded\.coordinates\[0\]/);
  assert.doesNotMatch(checkout, /formData\.get\("(?:latitude|longitude|coordinates)"\)/);
  assert.match(orderService, /zone_validation: snapshot\.zoneValidation/);
  assert.match(orderService, /validated_at: snapshot\.validatedAt/);
  assert.match(hardening, /v_snapshot->>'zone_validation' <> 'available'/);
  assert.match(hardening, /delivery_address_snapshot is not null[\s\S]+не может быть изменён/);
  assert.match(hardening, /v_checked_at < now\(\) - interval '10 minutes'/);
});

test("delivery fee is fiscalized as a service but stays out of kitchen and product metrics", () => {
  assert.match(migration, /'payment_subject', case when item\.item_type = 'delivery_fee' then 'service'/);
  assert.match(kitchenQueries, /where item\.order_id = any\(\$\{orderIds\}::uuid\[\]\)[\s\S]+item\.item_type = 'food'/);
  assert.match(migration, /where i\.item_type = 'food';/);
  assert.match(migration, /item\.item_type = 'food'[\s\S]+web_items\.items_count/);
  assert.match(orders, /item_type: row\.item_type === "delivery_fee" \? "delivery_fee" : "food"/);
  assert.match(erp, /if \(item\.item_type !== "food"\) continue/);
  assert.match(repeatOrder, /items\.filter\(\(item\) => item\.product_id\)/);
  assert.match(adminOrders, /const canViewDeliveryAddress = staff\.legacy \|\| \["owner", "admin", "manager"\]\.includes\(staff\.role\)/);
  assert.match(adminOrders, /canViewDeliveryAddress \? order\.address/);
  assert.match(adminOrders, /\{canViewDeliveryAddress \? \(/);
});

test("courier handoff is a separate paid delivery status before delivered", () => {
  assert.match(migration, /p_status = 'handed_to_courier'[\s\S]+v_order\.kitchen_status <> 'ready'/);
  assert.match(migration, /not v_order\.is_test and v_order\.payment_status not in \('paid', 'partially_refunded'\)/);
  assert.match(migration, /elsif v_order\.kitchen_status <> 'handed_to_courier'/);
  assert.match(kitchen, /order\.fulfillmentType === "delivery" \? "handed_to_courier"/);
  assert.doesNotMatch(kitchen, /Адрес доставки: \{order\.address\}/);
  assert.match(hardening, /v_event := 'delivery\.delivered'/);
  assert.match(fiscalMigration, /if new\.kitchen_status <> 'handed_out'[\s\S]+return new;/);
  assert.match(fiscalMigration, /old\.kitchen_status = 'handed_out'/);
});
