import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { SALE_FOOD_COST_JOIN } = loadTypeScript("src/lib/analytics/sale-food-cost.ts");

async function dashboardQueries() {
  const captured = [];
  const exports = {};
  const source = readFileSync("src/lib/analytics/dashboard.ts", "utf8")
    + "\nexport { getFoodCostMetricRow, getProductRows };";
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const imports = {
    "@/lib/postgres/server": { getPostgresSql: () => ({ unsafe: async (text) => {
      captured.push(text);
      return [];
    } }) },
    "./sale-food-cost": { SALE_FOOD_COST_JOIN },
    "./categories": { analyticsCategorySql: () => "i.category" },
    "./query": {
      buildSalesWhere: () => ({ text: "true", values: [] }),
      buildItemWhere: () => ({ text: "true", values: [] }),
      offsetPlaceholders: (text) => text
    }
  };
  new Function("require", "exports", compiled)((name) => imports[name] ?? {}, exports);
  await exports.getFoodCostMetricRow({}, {}, {});
  await exports.getProductRows({}, {}, {});
  return captured;
}

test("both dashboard cost aggregates resolve each canonical item before multiplying net quantity", async () => {
  const queries = await dashboardQueries();
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.ok(query.includes(SALE_FOOD_COST_JOIN));
    assert.match(query, /sum\(i\.net_quantity \* product_cost\.unit_food_cost\)/);
    assert.match(query, /i\.product_id is not null and coalesce\(product_cost\.is_complete, false\)/);
    assert.match(query, /canonical_analytics_sales s on s\.sale_id = i\.sale_id/);
  }
  assert.match(queries[0], /sum\(abs\(i\.net_revenue\)\)/);
  assert.match(queries[1], /sum\(i\.net_revenue\)/);
});

test("native snapshots use canonical item provenance and do not apply current waste twice", () => {
  assert.match(SALE_FOOD_COST_JOIN, /usage\.order_item_id = i\.source_record_id/);
  assert.match(SALE_FOOD_COST_JOIN, /i\.source = 'web'/);
  assert.match(SALE_FOOD_COST_JOIN, /sum\(usage\.quantity_per_item \* ingredient\.cost_per_unit\)/);
  assert.doesNotMatch(SALE_FOOD_COST_JOIN, /waste_percent|split_part|substring|s\.source\b/);
  assert.match(SALE_FOOD_COST_JOIN, /when i\.source = 'web' then\s+case when snapshot_cost\.is_complete then snapshot_cost\.unit_food_cost end/);
  assert.doesNotMatch(SALE_FOOD_COST_JOIN, /coalesce\(snapshot_cost\.unit_food_cost/);
});

const fixtures = {
  ingredients: [
    { id: "portion-piece", cost_per_unit: 14.4, waste_percent: 0, unit: "pcs" },
    { id: "piece", cost_per_unit: 10, waste_percent: 20, unit: "pcs" },
    { id: "extra", cost_per_unit: 4, waste_percent: 0, unit: "pcs" },
    { id: "zero-price", cost_per_unit: 0, waste_percent: 0, unit: "pcs" },
    { id: "null-price", cost_per_unit: null, waste_percent: 0, unit: "pcs" }
  ],
  recipes: [
    { product_id: "actual-portion", ingredient_id: "portion-piece", quantity: 6, unit: "pcs" },
    { product_id: "portion", ingredient_id: "piece", quantity: 6, unit: "pcs" },
    { product_id: "plain", ingredient_id: "piece", quantity: 6, unit: "pcs" },
    { product_id: "changed-recipe", ingredient_id: "piece", quantity: 999, unit: "pcs" },
    { product_id: "retired-portion", ingredient_id: "piece", quantity: 6, unit: "pcs" },
    { product_id: "broken-recipe", ingredient_id: "piece", quantity: 6, unit: "pcs" },
    { product_id: "broken-recipe", ingredient_id: "missing", quantity: 2, unit: "pcs" },
    { product_id: "null-price-recipe", ingredient_id: "piece", quantity: 6, unit: "pcs" },
    { product_id: "null-price-recipe", ingredient_id: "null-price", quantity: 2, unit: "pcs" }
  ],
  groups: [
    { product_id: "actual-portion", name: "Размер порции", is_active: true },
    { product_id: "portion", name: "Размер порции", is_active: true },
    { product_id: "retired-portion", name: "Размер порции", is_active: false }
  ],
  usage: [],
  items: [],
  sales: []
};

function item(name, {
  source = "web", product = "portion", netQuantity = 2, snapshot,
  mapping = source === "web" ? "native" : "confirmed", channel = source,
  sourceRecord = name
} = {}) {
  fixtures.items.push({
    sale_id: name, sale_item_id: name, source_record_id: sourceRecord,
    source, source_product_id: product, external_source_id: name,
    product_id: product, product_name: name, category: "Fixture", mapping_status: mapping,
    net_quantity: netQuantity, net_revenue: netQuantity * 100
  });
  fixtures.sales.push({ sale_id: name, source: channel, sale_count_eligible: true });
  for (const [ingredient_id, quantity_per_item, unit = "pcs"] of snapshot ?? []) {
    fixtures.usage.push({ order_item_id: sourceRecord, ingredient_id, quantity_per_item, unit });
  }
}

item("six", { snapshot: [["piece", 7.5]] });
item("twelve", { snapshot: [["piece", 15]] });
item("extras", { netQuantity: 3, snapshot: [["piece", 15], ["extra", 2]] });
item("removal", { netQuantity: 1, snapshot: [["extra", 2]] });
item("changed-recipe", { product: "changed-recipe", snapshot: [["piece", 15]] });
item("native-pos", { channel: "pos_evotor", snapshot: [["piece", 15]] });
item("missing-configured");
item("missing-legacy", { product: "plain" });
item("missing-ingredient", { snapshot: [["piece", 15], ["missing", 2]] });
item("unit-mismatch", { snapshot: [["piece", 15, "g"]] });
item("zero-price", { snapshot: [["piece", 15], ["zero-price", 2]] });
item("null-price", { snapshot: [["piece", 15], ["null-price", 2]] });
item("negative-usage", { snapshot: [["piece", -1]] });
item("zero-usage", { snapshot: [["piece", 0]] });
item("refunded-native", { netQuantity: 0, snapshot: [["piece", 15]] });
item("evotor-plain", { source: "pos_evotor", product: "plain" });
item("evotor-return", { source: "pos_evotor", product: "plain", netQuantity: -2 });
item("evotor-portion", { source: "pos_evotor" });
item("evotor-retired-portion", { source: "pos_evotor", product: "retired-portion" });
item("evotor-unconfirmed", { source: "pos_evotor", product: "plain", mapping: "suggested" });
item("evotor-broken-recipe", { source: "pos_evotor", product: "broken-recipe" });
item("evotor-null-price", { source: "pos_evotor", product: "null-price-recipe" });
item("evotor-id-collision", { source: "pos_evotor", product: "plain", sourceRecord: "twelve" });
item("unmapped", { source: "pos_evotor", product: null, mapping: "unmapped" });
item("portion-six", { product: "actual-portion", netQuantity: 1, snapshot: [["portion-piece", 6]] });
item("portion-twelve", { product: "actual-portion", netQuantity: 1, snapshot: [["portion-piece", 12]] });

const expectedCosts = {
  six: 150, twelve: 300, extras: 474, removal: 8, "changed-recipe": 300,
  "native-pos": 300, "zero-usage": 0, "refunded-native": 0,
  "evotor-plain": 150, "evotor-return": -150, "evotor-id-collision": 150,
  "portion-six": 86.4, "portion-twelve": 172.8
};

const fixtureCtes = `
  fixture_ingredients as (
    select * from jsonb_to_recordset($1::text::jsonb)
      as x(id text, cost_per_unit numeric, waste_percent numeric, unit text)
  ), fixture_recipes as (
    select * from jsonb_to_recordset($2::text::jsonb)
      as x(product_id text, ingredient_id text, quantity numeric, unit text)
  ), fixture_groups as (
    select * from jsonb_to_recordset($3::text::jsonb)
      as x(product_id text, name text, is_active boolean)
  ), fixture_usage as (
    select * from jsonb_to_recordset($4::text::jsonb)
      as x(order_item_id text, ingredient_id text, quantity_per_item numeric, unit text)
  ), fixture_items as (
    select * from jsonb_to_recordset($5::text::jsonb) as x(
      sale_id text, sale_item_id text, source_record_id text, source text,
      source_product_id text, external_source_id text, product_id text,
      product_name text, category text, mapping_status text, net_quantity numeric, net_revenue numeric
    )
  ), fixture_sales as (
    select * from jsonb_to_recordset($6::text::jsonb)
      as x(sale_id text, source text, sale_count_eligible boolean)
  )
`;

function fixtureQuery(query) {
  const tables = {
    product_ingredients: "fixture_recipes", ingredients: "fixture_ingredients",
    product_modifier_groups: "fixture_groups", order_item_ingredient_usage: "fixture_usage",
    analytics_sale_items: "fixture_items", canonical_analytics_sales: "fixture_sales"
  };
  assert.match(query.trimStart(), /^with /);
  let result = `with ${fixtureCtes}, ${query.trimStart().slice(5)}`;
  for (const [table, fixture] of Object.entries(tables)) result = result.replaceAll(`public.${table}`, fixture);
  assert.doesNotMatch(result, /public\.|\b(insert|update|delete|create|drop|alter)\b/i);
  return result;
}

test("synthetic SQL replaces every application table and contains no writes", async () => {
  for (const query of await dashboardQueries()) fixtureQuery(query);
});

test("PostgreSQL: portions, extras, removals, unknown coverage and canonical source isolation", {
  skip: !process.env.FOOD_COST_TEST_DATABASE_URL && "Set FOOD_COST_TEST_DATABASE_URL after disposable local PG is ready"
}, async () => {
  const url = new URL(process.env.FOOD_COST_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only local fixture PG is allowed");
  const sql = postgres(url.href, { max: 1, connect_timeout: 5 });
  let connection;
  try {
    connection = await sql.reserve();
    await connection.unsafe("begin read only");
    const queries = await dashboardQueries();
    // Check the migrated schema without executing a query against application rows.
    for (const query of queries) await connection.unsafe(`explain ${query}`);
    const values = [fixtures.ingredients, fixtures.recipes, fixtures.groups, fixtures.usage, fixtures.items, fixtures.sales].map(JSON.stringify);
    const [metric] = await connection.unsafe(fixtureQuery(queries[0]), values);
    const products = await connection.unsafe(fixtureQuery(queries[1]), values);
    assert.equal(products.length, fixtures.items.length);
    for (const row of products) {
      const complete = Object.hasOwn(expectedCosts, row.product_name);
      assert.equal(row.food_cost_complete, complete, row.product_name);
      assert.equal(Number(row.food_cost), expectedCosts[row.product_name] ?? 0, row.product_name);
      const original = fixtures.items.find((item) => item.product_name === row.product_name);
      assert.equal(Number(row.quantity), original.net_quantity, row.product_name);
      assert.equal(Number(row.revenue), original.net_revenue, row.product_name);
    }
    assert.equal(Number(metric.covered_item_rows), Object.keys(expectedCosts).length);
    assert.ok(Math.abs(Number(metric.food_cost) - Object.values(expectedCosts).reduce((sum, cost) => sum + cost, 0)) < 0.000001);
    assert.equal(Number(metric.covered_revenue), fixtures.items.filter((item) => Object.hasOwn(expectedCosts, item.product_name))
      .reduce((sum, item) => sum + item.net_revenue, 0));
    assert.equal(Number(metric.total_revenue), fixtures.items.reduce((sum, item) => sum + Math.abs(item.net_revenue), 0));

    const groupedItems = fixtures.items.filter((item) => item.product_id === "actual-portion")
      .map((item) => ({ ...item, product_name: "Same product, two serving sizes" }));
    const groupedValues = [...values];
    groupedValues[4] = JSON.stringify(groupedItems);
    const [grouped] = await connection.unsafe(fixtureQuery(queries[1]), groupedValues);
    assert.equal(Number(grouped.food_cost), 259.2);
    assert.equal(Number(grouped.quantity), 2);
    assert.equal(Number(grouped.revenue), 200);
    assert.equal(Number(grouped.receipts), 2);
    assert.equal(grouped.food_cost_complete, true);

    groupedValues[3] = JSON.stringify(fixtures.usage.filter((usage) => usage.order_item_id !== "portion-twelve"));
    const [incomplete] = await connection.unsafe(fixtureQuery(queries[1]), groupedValues);
    assert.equal(incomplete.food_cost_complete, false);
    assert.equal(Number(incomplete.food_cost), 86.4);
    assert.equal(Number(incomplete.covered_revenue), 100);
    assert.equal(Number(incomplete.revenue), 200);

    groupedValues[3] = values[3];
    groupedValues[0] = JSON.stringify(fixtures.ingredients.map((ingredient) => ingredient.id === "portion-piece"
      ? { ...ingredient, cost_per_unit: 28.8 }
      : ingredient));
    const [repriced] = await connection.unsafe(fixtureQuery(queries[1]), groupedValues);
    assert.equal(Number(repriced.food_cost), 518.4);
    assert.equal(Number(repriced.quantity), 2);
    assert.equal(Number(repriced.revenue), 200);
  } finally {
    try {
      if (connection) await connection.unsafe("rollback");
    } finally {
      connection?.release();
      await sql.end();
    }
  }
});
