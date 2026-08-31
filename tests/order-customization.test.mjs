import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260728083046_add_staff_kitchen_modifiers_scheduling_and_registers.sql");
const productIterationMigration = read("supabase/migrations/20260811223000_same_day_orders_waste_evotor_analytics.sql");
const orderFlowMigration = read("supabase/migrations/20260814120000_add_canonical_order_flow_kds.sql");
const orderAction = read("src/app/actions/orders.ts");
const cart = read("src/components/cart/CartProvider.tsx");
const cartDrawer = read("src/components/cart/CartDrawer.tsx");
const cartCustomizer = read("src/components/cart/CartLineCustomizer.tsx");
const productCustomizer = read("src/components/products/ProductCustomizer.tsx");
const ingredients = read("src/lib/ingredients.ts");
const kitchen = read("src/components/operations/KitchenWorkspace.tsx");
const sms = read("src/lib/verification/send-code.ts");
const registerProvider = read("src/lib/cash-register/provider.ts");
const evotorClient = read("src/lib/integrations/evotor/client.ts");
const evotorDocuments = read("src/lib/integrations/evotor/documents.ts");
const evotorSync = read("src/lib/integrations/evotor/sync.ts");

test("modifier price is authoritative and effective ingredients are snapshotted", () => {
  assert.match(migration, /v_line_unit_price := v_product\.price \+ v_extra_total/);
  assert.match(migration, /insert into public\.order_item_modifiers/);
  assert.match(migration, /insert into public\.order_item_ingredient_usage/);
  assert.match(migration, /pi\.is_removable = true/);
  assert.match(migration, /pi\.is_extra_available = true/);
  assert.match(orderAction, /address:\s*String\(formData\.get\("address"\) \|\| ""\)/);
  assert.match(orderAction, /comment:\s*String\(formData\.get\("comment"\) \|\| ""\)/);
  assert.doesNotMatch(orderAction, /unit_price|line_total|extra_price/);
});

test("cart keeps separately configured products as separate lines", () => {
  assert.match(cart, /function customizationKey/);
  assert.match(cart, /lineId: string/);
  assert.match(cart, /line\.lineId === lineId/);
  assert.match(cart, /updateCustomization/);
  assert.match(cartCustomizer, /Изменить состав/);
  assert.doesNotMatch(productCustomizer, /Выбрать состав/);
  assert.match(productCustomizer, /Добавлено/);
  assert.match(cartDrawer, /CartLineCustomizer/);
});

test("scheduled orders are limited to the current Moscow day", () => {
  assert.match(orderAction, /validateSameDayMoscowRequestedAt/);
  assert.doesNotMatch(orderAction, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(migration, /p_requested_at < now\(\) \+ interval '15 minutes'/);
  assert.match(productIterationMigration, /orders_requested_at_same_moscow_day_check/);
  assert.match(productIterationMigration, /at time zone 'Europe\/Moscow'/);
  assert.match(cartDrawer, /ScheduledTimeSlider/);
});

test("ingredient waste adjusts food cost and order usage", () => {
  assert.match(productIterationMigration, /add column if not exists waste_percent/);
  assert.match(productIterationMigration, /apply_ingredient_waste_to_order_usage/);
  assert.match(productIterationMigration, /1 - v_waste_percent \/ 100/);
  assert.match(ingredients, /getWasteAdjustedQuantity/);
  assert.match(ingredients, /grossQuantity \* costPerUnit/);
  assert.match(ingredients, /missing_price_ingredients/);
  assert.match(ingredients, /line\.cost_per_unit <= 0/);
});

test("kitchen displays modifiers and uses atomic status RPC", () => {
  assert.match(kitchen, /if \(type === "remove"\) return "БЕЗ"/);
  assert.match(kitchen, /if \(type === "replace"\) return "ЗАМЕНА"/);
  assert.match(migration, /create or replace function public\.set_order_status_staff_atomic/);
  assert.match(orderFlowMigration, /create or replace function public\.set_order_kitchen_status_atomic/);
  assert.match(orderFlowMigration, /select public\.set_order_status_staff_atomic/);
  assert.match(migration, /for update/);
  assert.match(migration, /order_inventory_deductions/);
});

test("staff and register tables are private and cash register is fail closed", () => {
  assert.match(migration, /create table if not exists public\.staff_users/);
  assert.match(migration, /check \(role in \('admin', 'manager', 'cook'\)\)/);
  assert.match(migration, /revoke all privileges on table public\.cash_registers from anon, authenticated/);
  assert.match(registerProvider, /class DisabledCashRegisterProvider/);
  assert.match(registerProvider, /Онлайн-касса не подключена/);
  assert.match(evotorClient, /application\/vnd\.evotor\.v2\+json/);
  assert.match(evotorClient, /method: "GET"/);
  assert.match(evotorDocuments, /\/documents/);
  assert.doesNotMatch(evotorSync, /inventory_items|inventory_movements/);
});

test("production SMS remains fail closed", () => {
  assert.match(sms, /if \(process\.env\.NODE_ENV !== "production"\)/);
  assert.match(sms, /return \{ ok: false \}/);
});
