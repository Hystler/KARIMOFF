import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260815103000_refine_pos_kds_display_operations.sql");
const pos = read("src/components/operations/PosWorkspace.tsx");
const customizer = read("src/components/operations/PosProductCustomizer.tsx");
const kitchen = read("src/components/operations/KitchenWorkspace.tsx");
const display = read("src/components/operations/PickupDisplay.tsx");
const queries = read("src/lib/order-flow/queries.ts");
const service = read("src/lib/order-flow/service.ts");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const dockerfile = read("Dockerfile");
const realtimeRoute = read("src/app/api/order-events/route.ts");
const realtimeServer = read("src/lib/order-flow/realtime.ts");
const posAction = read("src/app/pos/actions.ts");
const kitchenAction = read("src/app/kitchen/actions.ts");

function fixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-pos-ux-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "product-types.ts"), read("src/lib/product-types.ts"));
  writeFileSync(
    join(directory, "pos-cart.ts"),
    read("src/lib/order-flow/pos-cart.ts").replace(
      'from "@/lib/product-types"',
      'from "./product-types.ts"'
    )
  );
  writeFileSync(join(directory, "sla.ts"), read("src/lib/order-flow/sla.ts"));
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

test("POS customization previews real modifiers but serializes no trusted price", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const cart = await import(${JSON.stringify(files.url("pos-cart"))});
      const product = {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Бургер",
        slug: "burger",
        category: "Бургеры",
        description: null,
        price: 390,
        image_url: null,
        is_active: true,
        sort_order: 1,
        modifier_options: [
          { ingredient_id: "00000000-0000-4000-8000-000000000002", name: "Лук", unit: "g", base_quantity: 10, is_removable: true, is_extra_available: false, extra_quantity: 0, extra_price: 0, max_extra_quantity: 1, sort_order: 1 },
          { ingredient_id: "00000000-0000-4000-8000-000000000003", name: "Сыр", unit: "pcs", base_quantity: 1, is_removable: false, is_extra_available: true, extra_quantity: 1, extra_price: 50, max_extra_quantity: 3, sort_order: 2 }
        ],
        modifier_groups: [{
          id: "00000000-0000-4000-8000-000000000004",
          name: "Соус",
          selection_type: "single",
          min_selections: 1,
          max_selections: 1,
          sort_order: 1,
          options: [{ id: "00000000-0000-4000-8000-000000000005", label: "BBQ", modifier_type: "add", ingredient_id: "00000000-0000-4000-8000-000000000006", replacement_ingredient_id: null, quantity_delta: 20, unit: "g", price_delta: 10, kitchen_note: null, is_default: true, sort_order: 1 }]
        }]
      };
      const defaults = cart.defaultPosCustomization(product);
      const customization = { ...defaults, removedIngredientIds: [product.modifier_options[0].ingredient_id], extras: [{ ingredientId: product.modifier_options[1].ingredient_id, quantity: 2 }], note: "сильно прожарить" };
      const lines = cart.addPosCartLine([], product, customization, 1, "line-1");
      const merged = cart.addPosCartLine(lines, product, customization, 1, "line-2");
      const serialized = cart.serializePosCart(merged);
      console.log(JSON.stringify({
        quick: cart.canQuickAddProduct(product),
        unitPrice: cart.getPosLineUnitPrice(merged[0]),
        quantity: merged[0].quantity,
        serialized,
        hasClientPrice: "price" in serialized[0] || "unit_price" in serialized[0] || "line_total" in serialized[0]
      }));
    `);
  } finally {
    files.cleanup();
  }
  assert.equal(result.quick, true);
  assert.equal(result.unitPrice, 500);
  assert.equal(result.quantity, 2);
  assert.equal(result.hasClientPrice, false);
  assert.deepEqual(result.serialized[0].removed_ingredient_ids, ["00000000-0000-4000-8000-000000000002"]);
  assert.equal(result.serialized[0].extras[0].quantity, 2);
});

test("operational SLA rejects legacy, corrupt, and future timestamps", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const sla = await import(${JSON.stringify(files.url("sla"))});
      const now = new Date("2026-08-15T12:00:00Z");
      console.log(JSON.stringify({
        valid: sla.operationalElapsedSeconds("2026-08-15T11:50:00Z", now),
        legacy: sla.operationalElapsedSeconds("2026-07-01T10:00:00Z", now),
        future: sla.operationalElapsedSeconds("2026-08-15T12:10:00Z", now),
        missing: sla.operationalElapsedSeconds(null, now)
      }));
    `);
  } finally {
    files.cleanup();
  }
  assert.deepEqual(result, { valid: 600, legacy: null, future: null, missing: null });
});

test("operational cutover excludes legacy orders without mutating history", () => {
  assert.match(migration, /add column if not exists is_operational boolean not null default false/);
  assert.doesNotMatch(migration, /update public\.orders[\s\S]+set is_operational = true[\s\S]+where is_operational = false/);
  assert.match(queries, /and o\.is_operational = true/);
  assert.match(queries, /and order_row\.is_operational = true/);
  assert.match(kitchen, /operationalElapsedSeconds/);
  assert.doesNotMatch(kitchen, /order\.id\.slice/);
});

test("test orders run through KDS but skip stock and business analytics", () => {
  assert.match(service, /process\.env\.TEST_ORDER_MODE === "true"/);
  assert.match(service, /p_is_test: isTest/g);
  assert.match(migration, /if v_order\.is_test then[\s\S]+\u0422\u0435\u0441\u0442\u043e\u0432\u044b\u0439 \u0437\u0430\u043a\u0430\u0437/);
  const testBranch = migration.slice(migration.indexOf("if v_order.is_test then"), migration.indexOf("elsif p_status = 'ready' then"));
  assert.doesNotMatch(testBranch, /inventory|set_order_status_staff_atomic|loyalty|fiscal/);
  assert.match(migration, /where o\.id is null or not o\.is_test/);
  assert.match(pos, /Тестовый режим: заказы видны кухне/);
});

test("structured modifiers are server-validated and snapshot effective ingredients", () => {
  assert.match(migration, /create table if not exists public\.product_modifier_groups/);
  assert.match(migration, /create table if not exists public\.product_modifier_options/);
  assert.match(migration, /selection_type in \('single', 'multi'\)/);
  assert.match(migration, /modifier_type in \('remove', 'add', 'replace'\)/);
  assert.match(migration, /group_row\.min_selections/);
  assert.match(migration, /v_line_unit_price := v_product\.price \+ v_extra_total \+ v_group_total/);
  assert.match(migration, /insert into public\.order_item_ingredient_usage/);
  assert.match(migration, /on conflict \(order_item_id, ingredient_id\)/);
  assert.match(customizer, /Убрать/);
  assert.match(customizer, /Добавить/);
  assert.match(customizer, /Комментарий к позиции/);
  assert.match(customizer, /canClearSelection/);
  assert.match(customizer, /\[option\.ingredient_id\]: 0/);
});

test("POS edit path preserves a cart line and KDS makes modifiers unmissable", () => {
  assert.match(pos, /customizer\.line\.lineId/);
  assert.match(pos, /current\.filter\(\(line\) => line\.lineId !== customizer\.line/);
  assert.match(pos, /serializePosCart\(cart\)/);
  assert.match(pos, /setCustomizer\(\{ product: line\.product, line \}\)/);
  assert.match(kitchen, /modifierPrefix\(modifier\.type\)/);
  assert.match(kitchen, /function modifierLabel/);
  assert.match(kitchen, /НЕ ДОБАВЛЯТЬ/);
  assert.match(kitchen, /К позиции/);
});

test("POS server action exports functions only", () => {
  assert.match(posAction, /export async function createPosOrderAction/);
  assert.doesNotMatch(posAction, /export const initialPosOrderActionState/);
  assert.match(kitchenAction, /export async function transitionKitchenOrderAction/);
  assert.doesNotMatch(kitchenAction, /export const initialKitchenActionState/);
});

test("pickup display uses spatial transitions, persistent optional sound, and restrained brand color", () => {
  assert.match(display, /AnimatePresence mode="popLayout"/);
  assert.match(display, /LayoutGroup/);
  assert.match(display, /layoutId={`pickup-order-\$\{order\.id\}`}/);
  assert.match(display, /SOUND_STORAGE_KEY/);
  assert.match(display, /playReadySound/);
  assert.match(display, /useReducedMotion/);
  assert.match(display, /Готовится/);
  assert.match(display, /Готово/);
  assert.doesNotMatch(display, /<section className="[^"]*bg-\[#FB670A\]/);
});

test("order screens use PostgreSQL notifications with a bounded recovery poll", () => {
  assert.match(realtimeServer, /\.listen\("karimoff_order_events"/);
  assert.match(realtimeServer, /listeners\.delete/);
  assert.match(realtimeRoute, /listenOrderOutboxNotifications/);
  assert.match(realtimeRoute, /RECOVERY_INTERVAL_MS = 5_000/);
  assert.doesNotMatch(realtimeRoute, /POLL_INTERVAL_MS = 2_500/);
});

test("standalone startup applies the POS/KDS refinement migration", () => {
  assert.match(runtimeMigrations, /name: "20260815103000_refine_pos_kds_display_operations"/);
  assert.match(runtimeMigrations, /to_regclass\('public\.product_modifier_groups'\)/);
  assert.match(runtimeMigrations, /create_site_order\(uuid,text,text,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamp with time zone,boolean\)/);
  assert.match(dockerfile, /20260815103000_refine_pos_kds_display_operations\.sql/);
});
