import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { buildPurchasePlan, planningQuantity } = loadTypeScript("src/lib/analytics/planning-math.ts");
const { resolvePlanningSales } = loadTypeScript("src/lib/analytics/planning-composition.ts");
const { foodCostIdentityRows } = loadTypeScript("src/lib/analytics/evotor-food-cost-identities.ts");
const rules = foodCostIdentityRows();
const parameters = { weekdaySamples: Array(7).fill(4), futureWeekdays: Array.from({ length: 366 }, (_, i) => i % 7), horizon: 7, bufferDays: 0 };
const ingredient = (id, unit = "g", overrides = {}) => ({ id, name: id, unit, active: true,
  wastePercent: 20, stock: 0, reserved: 0, minimum: 0, cost: 2, packageSize: 1, ...overrides });
const position = (overrides = {}) => ({ productId: "ordinary", name: "Shawarma", weekday: 1, quantity: 4,
  revenue: 1000, source: "pos_evotor", mappingStatus: "confirmed", sku: "ordinary-sku", storeId: "store",
  receiptName: "Shawarma", closedAt: "2026-09-20T12:00:00Z", compound: false, snapshot: [], ...overrides });
const ordinary = (overrides = {}) => ({ positions: [position()], products: [{ id: "ordinary", slug: "ordinary", name: "Shawarma", active: true }],
  recipes: [{ productId: "ordinary", ingredientId: "chicken", quantity: 90, unit: "g" }],
  ingredients: [ingredient("chicken")], options: [], ...overrides });
const planFor = (data, options = {}) => buildPurchasePlan({ ...data, sales: resolvePlanningSales(data), ...parameters, ...options });

function identitiesFixture() {
  const data = ordinary({ positions: [], products: [], recipes: [], ingredients: [], options: [] });
  const addIngredient = (id, unit) => {
    if (!data.ingredients.some((i) => i.id === id)) data.ingredients.push(ingredient(id, unit));
  };
  addIngredient("ordinary-component", "pcs");
  for (const rule of rules) {
    if (rule.ingredient_id) addIngredient(rule.ingredient_id, rule.unit);
    if (rule.original_ingredient_id) addIngredient(rule.original_ingredient_id, rule.unit);
    if (rule.product_slug && !data.products.some((p) => p.slug === rule.product_slug)) {
      const id = rule.product_slug;
      data.products.push({ id, slug: id, name: id, active: true });
      if (rule.kind === "recipe") data.recipes.push({ productId: id, ingredientId: "ordinary-component", quantity: 2, unit: "pcs" });
      else {
        data.recipes.push({ productId: id, ingredientId: rule.original_ingredient_id ?? rule.ingredient_id, quantity: 90, unit: rule.unit });
        if (rule.kind === "replacement") data.recipes.push({ productId: id, ingredientId: "ordinary-component", quantity: 2, unit: "pcs" });
      }
    }
    if (["portion", "replacement"].includes(rule.kind)) data.options.push({ productId: rule.product_slug,
      groupName: rule.kind === "portion" ? "Размер порции" : "Начинка", modifierType: "replace",
      ingredientId: rule.original_ingredient_id ?? rule.ingredient_id, replacementIngredientId: rule.ingredient_id,
      quantity: rule.quantity, unit: rule.unit });
    data.positions.push(position({ productId: ["portion", "replacement"].includes(rule.kind) ? rule.product_slug : null,
      name: "Collapsed name", mappingStatus: ["portion", "replacement"].includes(rule.kind) ? "confirmed" : "unmapped",
      sku: rule.sku, storeId: rule.store_id, receiptName: rule.names[0] }));
  }
  return data;
}

test("zero optional components do not invalidate an ordinary recipe; no positive composition stays unknown", () => {
  const data = ordinary();
  data.recipes.push({ productId: "ordinary", ingredientId: "absent-optional", quantity: 0, unit: "pcs" });
  const plan = planFor(data);
  assert.equal(plan.coverage, 100);
  assert.equal(plan.revenueCoverage, 100);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].demand, 112.5);
  assert.equal(planFor({ ...data, recipes: data.recipes.slice(1) }).coverage, 0);
});

test("all 41 verified SKU identities decompose portions, recipes, components without product_id and replacements", () => {
  const data = identitiesFixture();
  const before = JSON.stringify(data);
  const sales = resolvePlanningSales(data);
  assert.equal(sales.length, 41);
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index], sale = sales[index];
    assert.equal(sale.recipeIssue, null, rule.sku);
    if (rule.kind === "recipe") assert.equal(sale.composition[0].quantity, 2);
    else assert.equal(sale.composition.find((c) => c.ingredientId === rule.ingredient_id).quantity, rule.quantity, rule.sku);
    if (rule.kind === "replacement" && rule.original_ingredient_id !== rule.ingredient_id) {
      assert.ok(!sale.composition.some((c) => c.ingredientId === rule.original_ingredient_id));
    }
  }
  const plan = planFor(data);
  assert.equal(plan.coverage, 100);
  assert.equal(plan.revenueCoverage, 100);
  assert.equal(plan.totalUnits, 41 * 4);
  assert.equal(plan.totalRevenue, 41000);
  assert.equal(plan.budgetComplete, true);
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const resolved = planFor({ ...data, positions: [data.positions[index]] });
    const costFromComponents = resolved.rows.reduce((sum, row) => sum + row.demand * row.unitCost, 0);
    const netRecipe = rule.kind === "recipe" ? 2 : rule.quantity + (rule.kind === "replacement" ? 2 : 0);
    assert.ok(Math.abs(costFromComponents - netRecipe / 0.8 * 2) < 1e-6, `Food-cost quantity/waste contract: ${rule.sku}`);
  }
  assert.equal(JSON.stringify(data), before, "Reads must not mutate mappings, receipts or inventory");
});

test("unknown portion, forged/conflicting SKU, store, receipt label, dates and compound positions fail closed", () => {
  const data = identitiesFixture();
  for (const mutation of [
    { sku: "unverified-sku" }, { storeId: "another-store" }, { mappingStatus: "suggested" },
    { mappingStatus: "rejected" }, { receiptName: "another product" }, { closedAt: "2026-09-10T12:00:00Z" },
    { closedAt: "not-a-date" }, { closedAt: null }, { compound: true }, { productId: "ordinary" }
  ]) {
    const changed = { ...data, positions: [{ ...data.positions[0], ...mutation }] };
    assert.equal(planFor(changed).coverage, 0, JSON.stringify(mutation));
  }
  const invalid = structuredClone(data);
  invalid.recipes.push({ productId: rules[0].product_slug, ingredientId: "ordinary-component", quantity: 1, unit: "pcs" });
  assert.equal(planFor({ ...invalid, positions: [invalid.positions[0]] }).coverage, 0);
  invalid.recipes.at(-1).quantity = 0;
  assert.equal(planFor({ ...invalid, positions: [invalid.positions[0]] }).coverage, 100);
});

test("native snapshots override today's recipe, include extras/removals and never apply waste twice", () => {
  const data = ordinary({ positions: [position({ source: "web", sku: null, snapshot: [
    { ingredientId: "chicken", quantity: 150, unit: "g" },
    { ingredientId: "cheese", quantity: 1, unit: "pcs" },
    { ingredientId: "removed", quantity: 0, unit: "g" }
  ] })], ingredients: [ingredient("chicken"), ingredient("cheese", "pcs")],
  options: [{ productId: "ordinary", groupName: "Размер порции", modifierType: "replace" }] });
  const plan = planFor(data);
  assert.equal(plan.coverage, 100);
  assert.equal(plan.rows.find((r) => r.id === "chicken").demand, 150);
  assert.equal(plan.rows.find((r) => r.id === "cheese").demand, 1);
  assert.equal(planFor({ ...data, positions: [position({ source: "web", snapshot: [] })] }).coverage, 0);
});

test("same catalog product keeps distinct confirmed sizes and composition snapshots", () => {
  const data = ordinary({ positions: [90, 150].map((q) => position({ source: "web", snapshot: [{ ingredientId: "chicken", quantity: q, unit: "g" }] })) });
  const plan = planFor(data);
  assert.equal(plan.products.length, 2);
  assert.equal(plan.rows[0].demand, 240);
});

test("unknown prices do not exclude a composition or silently make a complete budget", () => {
  const data = ordinary({ ingredients: [ingredient("chicken", "g", { cost: null })] });
  const plan = planFor(data);
  assert.equal(plan.coverage, 100);
  assert.equal(plan.revenueCoverage, 100);
  assert.equal(plan.rows[0].budget, null);
  assert.equal(plan.missingPrices, 1);
  assert.equal(plan.budgetComplete, false);
  const partial = planFor({ ...data, positions: [...data.positions, position({ productId: null, sku: "unknown", revenue: 9000 })] });
  assert.equal(partial.coverage, 50);
  assert.equal(partial.revenueCoverage, 10);
  assert.equal(partial.totalRevenue, 10000);
  assert.equal(partial.products.find((p) => p.issue).forecast, 1);
});

test("units, negative stock and pack rounding stay dimensionally correct without guessing grams per piece", () => {
  assert.equal(planningQuantity(1.5, "kg", "g"), 1500);
  assert.equal(planningQuantity(0.25, "l", "ml"), 250);
  assert.equal(planningQuantity(100, "g", "pcs"), null);
  assert.equal(planningQuantity(-1, "g", "g"), null);
  assert.equal(planningQuantity(1, "__proto__", "__proto__"), null);
  assert.equal(planningQuantity(1, "constructor", "constructor"), null);
  assert.equal(planningQuantity(Number.MAX_VALUE, "kg", "g"), null);
  const data = ordinary({ recipes: [{ productId: "ordinary", ingredientId: "chicken", quantity: 0.09, unit: "kg" }],
    ingredients: [ingredient("chicken", "g", { stock: -100, reserved: 50, packageSize: 200 })] });
  const row = planFor(data).rows[0];
  assert.equal(row.demand, 112.5);
  assert.equal(row.stockDeficit, 150);
  assert.equal(row.packages, 2);
  assert.equal(row.purchase, 400);
  assert.equal(planFor({ ...data, recipes: [{ ...data.recipes[0], unit: "pcs" }] }).coverage, 0);
});

test("kilogram/litre inventory, prices and packaging normalize together; duplicate positive components fail closed", () => {
  const data = ordinary({ ingredients: [ingredient("chicken", "kg", { stock: -0.1, reserved: 0.05, packageSize: 0.2, cost: 2000 })] });
  const row = planFor(data).rows[0];
  assert.equal(row.unit, "g");
  assert.equal(row.unitCost, 2);
  assert.equal(row.recordedStock, -100);
  assert.equal(row.stockDeficit, 150);
  assert.equal(row.packageSize, 200);
  assert.equal(row.purchase, 400);
  assert.equal(row.budget, 800);
  const drink = planFor(ordinary({ recipes: [{ productId: "ordinary", ingredientId: "chicken", quantity: 250, unit: "ml" }],
    ingredients: [ingredient("chicken", "l", { cost: 100, packageSize: 1, wastePercent: 0 })] })).rows[0];
  assert.equal(drink.unit, "ml");
  assert.equal(drink.unitCost, 0.1);
  assert.equal(drink.purchase, 1000);
  const duplicate = ordinary();
  duplicate.recipes.push({ ...duplicate.recipes[0] });
  assert.equal(planFor(duplicate).coverage, 0);
  assert.equal(planFor(duplicate).rows.length, 0);
});

test("missing packaging and empty size groups remain explicit rather than a confident budget or base portion", () => {
  const unknownPack = planFor(ordinary({ ingredients: [ingredient("chicken", "g", { packageSize: null })] }));
  assert.equal(unknownPack.missingPackages, 1);
  assert.equal(unknownPack.budgetComplete, false);
  const incompleteGroup = ordinary({ options: [{ productId: "ordinary", groupName: "Размер порции", modifierType: null,
    ingredientId: null, replacementIngredientId: null, quantity: null, unit: null }] });
  assert.equal(planFor(incompleteGroup).coverage, 0);
  assert.equal(planFor(incompleteGroup).products[0].recipePresent, true);
});

test("imported chicken shawarma tech card decomposes its 83g cabbage and 90g meat exactly once", () => {
  const cards = JSON.parse(readFileSync("data/tech-cards/karimoff-tech-card-2026-08-11.json", "utf8"));
  const recipe = cards.recipes.find((r) => r.product_slugs.includes("shaurma-kurinaya"));
  const data = ordinary({ recipes: recipe.lines.map((line) => ({ productId: "ordinary", ingredientId: line.ingredient,
    quantity: line.quantity, unit: cards.ingredients.find((i) => i.key === line.ingredient).unit })),
    ingredients: recipe.lines.map((line) => {
      const i = cards.ingredients.find((i) => i.key === line.ingredient);
      return ingredient(i.key, i.unit, { wastePercent: i.waste_percent });
    }) });
  data.recipes.push({ productId: "ordinary", ingredientId: "optional-zero", quantity: 0, unit: "pcs" });
  const plan = planFor(data);
  assert.equal(plan.coverage, 100);
  assert.equal(plan.rows.find((r) => r.id === "cabbage").demand, 103.75);
  assert.equal(plan.rows.find((r) => r.id === "chicken").demand, 90);
  assert.equal(plan.rows.find((r) => r.id === "lavash").demand, 1);
});

const imports = { "server-only": {}, "@/lib/postgres/server": {}, "./permissions": {} };
const { PLANNING_POSITIONS_SQL, PLANNING_TOTALS_SQL } = loadTypeScript("src/lib/analytics/planning.ts", imports);
test("planning reads canonical sales only, stays owner/admin scoped and contains no business write path", () => {
  const source = readFileSync("src/lib/analytics/planning.ts", "utf8");
  assert.match(source, /repeatable read, read only/);
  assert.match(source, /set local jit = off/);
  assert.match(source, /scope.locationIds !== null/);
  assert.doesNotMatch(source, /\b(insert into|update public|delete from|syncEvotor|createOrder)\b/i);
  for (const query of [PLANNING_POSITIONS_SQL, PLANNING_TOTALS_SQL]) {
    assert.match(query, /s.analytics_included and s.sale_count_eligible and i.operation_type = 'sale'/);
    assert.match(query, /\$1::timestamptz/);
  }
});

test("PostgreSQL: composition join matches canonical quantity/revenue, snapshots, returns and Moscow boundaries", {
  skip: !process.env.PLANNING_TEST_DATABASE_URL && "Requires disposable loopback PostgreSQL"
}, async () => {
  const url = new URL(process.env.PLANNING_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/karimoff_planning_\d+$/);
  const sql = postgres(url.href, { max: 1, prepare: false });
  const fixtures = `with
    fixture_canonical_analytics_sales as (
      select 'pos'::text sale_id, true analytics_included, true sale_count_eligible, '2026-09-17T21:00:00Z'::timestamptz analytics_at
      union all select 'web', true, true, '2026-09-18T12:00:00Z'
      union all select 'return', true, false, '2026-09-18T12:00:00Z'
      union all select 'excluded', false, true, '2026-09-18T12:00:00Z'
      union all select 'outside', true, true, '2026-09-17T20:59:59Z'
    ), fixture_analytics_sale_items as (
      select sale_id, null::uuid product_id, 'synthetic'::text product_name, 2::numeric quantity, 100::numeric net_revenue,
        case when sale_id='web' then 'web' else 'pos_evotor' end source, 'unmapped'::text mapping_status,
        case when sale_id='return' then 'refund' else 'sale' end operation_type, '00000000-0000-4000-8000-000000000001'::uuid source_record_id
      from fixture_canonical_analytics_sales
    ), fixture_evotor_receipt_items as (
      select '00000000-0000-4000-8000-000000000001'::uuid id, '00000000-0000-4000-8000-000000000002'::uuid receipt_id,
        'known-sku'::text evotor_product_id, 'Original portion'::text name, '{}'::jsonb raw_metadata
    ), fixture_evotor_receipts as (select '00000000-0000-4000-8000-000000000002'::uuid id,
      '00000000-0000-4000-8000-000000000003'::uuid store_id, '2026-09-18T12:00:00Z'::timestamptz closed_at),
    fixture_evotor_stores as (select '00000000-0000-4000-8000-000000000003'::uuid id, 'known-store'::text evotor_store_id),
    fixture_order_item_ingredient_usage as (select '00000000-0000-4000-8000-000000000001'::uuid order_item_id,
      '00000000-0000-4000-8000-000000000004'::uuid ingredient_id, 125::numeric quantity_per_item, 'g'::text unit)
  `;
  const query = (text) => fixtures + text.replaceAll("public.", "fixture_");
  try {
    await sql.begin("read only", async (tx) => {
      await tx.unsafe("set local jit=off");
      const values = ["2026-09-17T21:00:00Z", "2026-09-18T21:00:00Z"];
      const rows = await tx.unsafe(query(PLANNING_POSITIONS_SQL), values);
      const [totals] = await tx.unsafe(query(PLANNING_TOTALS_SQL), values);
      assert.equal(rows.length, 2);
      assert.equal(rows.reduce((sum, r) => sum + r.quantity, 0), totals.quantity);
      assert.equal(rows.reduce((sum, r) => sum + r.revenue, 0), totals.revenue);
      assert.equal(totals.quantity, 4);
      assert.equal(totals.revenue, 200);
      assert.ok(rows.every((r) => r.weekday === 5));
      const native = rows.find((r) => r.source === 'web'), receipt = rows.find((r) => r.source === 'pos_evotor');
      assert.equal(native.snapshot[0].quantity, 125);
      assert.equal(native.sku, null, 'Native UUID collision must not use a receipt identity');
      assert.equal(receipt.snapshot.length, 0, 'Receipt UUID collision must not use native snapshots');
      assert.equal(receipt.sku, 'known-sku');
      assert.equal(receipt.storeId, 'known-store');
    });
  } finally { await sql.end(); }
});
