import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260728083046_add_staff_kitchen_modifiers_scheduling_and_registers.sql");
const orderAction = read("src/app/actions/orders.ts");
const cart = read("src/components/cart/CartProvider.tsx");
const kitchen = read("src/components/admin/KitchenBoard.tsx");
const sms = read("src/lib/verification/send-code.ts");
const registerProvider = read("src/lib/cash-register/provider.ts");

test("modifier price is authoritative and effective ingredients are snapshotted", () => {
  assert.match(migration, /v_line_unit_price := v_product\.price \+ v_extra_total/);
  assert.match(migration, /insert into public\.order_item_modifiers/);
  assert.match(migration, /insert into public\.order_item_ingredient_usage/);
  assert.match(migration, /pi\.is_removable = true/);
  assert.match(migration, /pi\.is_extra_available = true/);
  assert.doesNotMatch(orderAction, /unit_price|line_total|extra_price/);
});

test("cart keeps separately configured products as separate lines", () => {
  assert.match(cart, /function customizationKey/);
  assert.match(cart, /lineId: string/);
  assert.match(cart, /line\.lineId === lineId/);
});

test("scheduled orders are bounded on server and in PostgreSQL", () => {
  assert.match(orderAction, /15 \* 60 \* 1000/);
  assert.match(orderAction, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(migration, /p_requested_at < now\(\) \+ interval '15 minutes'/);
  assert.match(migration, /p_requested_at > now\(\) \+ interval '7 days'/);
});

test("kitchen displays modifiers and uses atomic status RPC", () => {
  assert.match(kitchen, /modifier\.modifier_type === "remove" \? "БЕЗ" : "ДОБАВИТЬ"/);
  assert.match(migration, /create or replace function public\.set_order_status_staff_atomic/);
  assert.match(migration, /for update/);
  assert.match(migration, /order_inventory_deductions/);
});

test("staff and register tables are private and cash register is fail closed", () => {
  assert.match(migration, /create table if not exists public\.staff_users/);
  assert.match(migration, /check \(role in \('admin', 'manager', 'cook'\)\)/);
  assert.match(migration, /revoke all privileges on table public\.cash_registers from anon, authenticated/);
  assert.match(registerProvider, /class DisabledCashRegisterProvider/);
  assert.match(registerProvider, /Онлайн-касса не подключена/);
});

test("production SMS remains fail closed", () => {
  assert.match(sms, /if \(process\.env\.NODE_ENV !== "production"\)/);
  assert.match(sms, /return \{ ok: false \}/);
});
