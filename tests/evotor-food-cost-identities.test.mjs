import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { foodCostIdentityRows } = loadTypeScript('src/lib/analytics/evotor-food-cost-identities.ts');
const { PRODUCT_FOOD_COST_CTE, SALE_FOOD_COST_JOIN } = loadTypeScript('src/lib/analytics/sale-food-cost.ts');
const rules = foodCostIdentityRows();

test('explicit identities are unique, complete and never infer unknown quantities or prices', () => {
  assert.equal(rules.length, 41);
  assert.equal(rules.filter(r => r.kind === 'portion').length, 12);
  assert.equal(rules.filter(r => r.kind === 'recipe').length, 5);
  assert.throws(() => foodCostIdentityRows([rules[0], rules[0]]), /Duplicate/);
  assert.throws(() => foodCostIdentityRows([{ ...rules[0], quantity: 0 }]), /Incomplete/);
  assert.throws(() => foodCostIdentityRows([{ ...rules[0], quantity: Infinity }]), /Incomplete/);
  assert.throws(() => foodCostIdentityRows([{ ...rules[0], names: [] }]), /Incomplete/);
  assert.ok(rules.every(r => !('cost_per_unit' in r) && !('price' in r)));
  assert.ok(!rules.some(r => r.names.some(n => /добрый|халапеньо|бекон|фри доп|лук фри|соус/i.test(n))));
  assert.doesNotMatch(SALE_FOOD_COST_JOIN, /regexp_match|like '%'|limit 1/i);
});

function fixture() {
  const data = { products: [], ingredients: [], product_ingredients: [], product_modifier_groups: [],
    product_modifier_options: [], evotor_receipt_items: [], evotor_receipts: [], evotor_stores: [], items: [] };
  const products = new Map();
  const ingredients = new Map();
  const expected = new Map();
  const addIngredient = (id, unit) => {
    if (!ingredients.has(id)) {
      const ingredient = { id, unit, name: 'Synthetic ingredient', cost_per_unit: 10 + ingredients.size, waste_percent: 20 };
      ingredients.set(id, ingredient);
      data.ingredients.push(ingredient);
    }
    assert.equal(ingredients.get(id).unit, unit);
    return ingredients.get(id).cost_per_unit / 0.8;
  };
  const genericIngredient = randomUUID();
  const genericPrice = addIngredient(genericIngredient, 'pcs');
  for (const rule of rules) {
    if (rule.ingredient_id) addIngredient(rule.ingredient_id, rule.unit);
    if (rule.original_ingredient_id) addIngredient(rule.original_ingredient_id, rule.unit);
    if (rule.product_slug && !products.has(rule.product_slug)) {
      const product = { id: randomUUID(), slug: rule.product_slug };
      products.set(rule.product_slug, product);
      data.products.push(product);
      if (rule.kind === 'recipe') {
        data.product_ingredients.push({ product_id: product.id, ingredient_id: genericIngredient, quantity: 2, unit: 'pcs' });
      } else {
        data.product_ingredients.push({ product_id: product.id,
          ingredient_id: rule.original_ingredient_id ?? rule.ingredient_id, quantity: rule.quantity, unit: rule.unit });
        if (rule.kind === 'replacement') {
          data.product_ingredients.push({ product_id: product.id, ingredient_id: genericIngredient, quantity: 2, unit: 'pcs' });
        }
      }
    }
    const product = products.get(rule.product_slug);
    if (['portion', 'replacement'].includes(rule.kind)) {
      const group = { id: randomUUID(), product_id: product.id,
        name: rule.kind === 'portion' ? 'Размер порции' : 'Начинка', is_active: true };
      data.product_modifier_groups.push(group);
      data.product_modifier_options.push({ id: randomUUID(), group_id: group.id,
        modifier_type: 'replace', ingredient_id: rule.original_ingredient_id ?? rule.ingredient_id,
        replacement_ingredient_id: rule.ingredient_id, quantity_delta: rule.quantity,
        unit: rule.unit, is_active: true, sort_order: 0 });
    }
    const store = { id: randomUUID(), evotor_store_id: rule.store_id };
    const receipt = { id: randomUUID(), store_id: store.id, closed_at: '2026-09-20T12:00:00Z' };
    const position = { id: randomUUID(), receipt_id: receipt.id, evotor_product_id: rule.sku,
      name: rule.names[0], raw_metadata: { sub_positions: [], extra_keys: [] } };
    const item = { sale_item_id: rule.sku, source: 'pos_evotor', source_record_id: position.id,
      product_id: ['portion', 'replacement'].includes(rule.kind) ? product.id : null,
      product_name: 'Collapsed catalog name', mapping_status: ['portion', 'replacement'].includes(rule.kind) ? 'confirmed' : 'unmapped',
      net_quantity: 2, net_revenue: 100 };
    data.evotor_stores.push(store);
    data.evotor_receipts.push(receipt);
    data.evotor_receipt_items.push(position);
    data.items.push(item);
    const unitCost = rule.kind === 'recipe' ? 2 * genericPrice
      : rule.quantity * ingredients.get(rule.ingredient_id).cost_per_unit / 0.8
        + (rule.kind === 'replacement' ? 2 * genericPrice : 0);
    expected.set(item.sale_item_id, unitCost * item.net_quantity);
  }
  const first = data.items[0];
  const position = data.evotor_receipt_items[0];
  const addCase = (name, mutation, cost = null, templateIndex = 0) => {
    const template = data.items[templateIndex];
    const templatePosition = data.evotor_receipt_items.find(p => p.id === template.source_record_id);
    const templateReceipt = data.evotor_receipts.find(r => r.id === templatePosition.receipt_id);
    const templateStore = data.evotor_stores.find(s => s.id === templateReceipt.store_id);
    const s = { ...templateStore, id: randomUUID() };
    const r = { ...templateReceipt, id: randomUUID(), store_id: s.id };
    const p = { ...templatePosition, id: randomUUID(), receipt_id: r.id };
    const i = { ...template, sale_item_id: name, source_record_id: p.id };
    mutation({ i, p, r, s });
    data.evotor_stores.push(s); data.evotor_receipts.push(r); data.evotor_receipt_items.push(p); data.items.push(i);
    expected.set(name, cost);
  };
  addCase('wrong-store', ({ s }) => { s.evotor_store_id = 'unverified-store'; });
  addCase('unknown-sku-same-name', ({ p }) => { p.evotor_product_id = randomUUID(); });
  addCase('known-sku-reused-name', ({ p }) => { p.name = 'Other product 150 гр.'; });
  addCase('before-recipe-evidence', ({ r }) => { r.closed_at = '2026-09-10T12:00:00Z'; });
  addCase('unsupported-sub-position', ({ p }) => { p.raw_metadata = { sub_positions: [{ product_id: 'extra' }], extra_keys: [] }; });
  addCase('unsupported-extra-keys', ({ p }) => { p.raw_metadata = { sub_positions: [], extra_keys: ['remove-onion'] }; });
  addCase('not-confirmed-portion', ({ i }) => { i.mapping_status = 'suggested'; });
  addCase('rejected-portion', ({ i }) => { i.mapping_status = 'rejected'; });
  addCase('native-id-collision', ({ i }) => { i.source = 'web'; });
  const returned = ({ i }) => { i.net_quantity = -1; i.net_revenue = -50; };
  addCase('return-exact-size', returned, -expected.get(first.sale_item_id) / 2);
  for (const kind of ['recipe', 'component']) {
    const index = rules.findIndex(rule => rule.kind === kind);
    addCase(`return-exact-${kind}`, returned, -expected.get(rules[index].sku) / 2, index);
  }
  const recipeIndex = rules.findIndex(rule => rule.kind === 'recipe');
  addCase('conflicting-recipe-product', ({ i }) => { i.product_id = randomUUID(); }, null, recipeIndex);
  addCase('receipt-label-case', ({ p }) => { p.name = position.name.toUpperCase(); }, expected.get(first.sale_item_id));
  return { data, expected };
}

const columns = {
  products: 'id uuid, slug text',
  ingredients: 'id uuid, name text, unit text, cost_per_unit numeric, waste_percent numeric',
  product_ingredients: 'product_id uuid, ingredient_id uuid, quantity numeric, unit text',
  product_modifier_groups: 'id uuid, product_id uuid, name text, is_active boolean',
  product_modifier_options: 'id uuid, group_id uuid, modifier_type text, ingredient_id uuid, replacement_ingredient_id uuid, quantity_delta numeric, unit text, is_active boolean, sort_order integer',
  evotor_receipt_items: 'id uuid, receipt_id uuid, evotor_product_id text, name text, raw_metadata jsonb',
  evotor_receipts: 'id uuid, store_id uuid, closed_at timestamptz',
  evotor_stores: 'id uuid, evotor_store_id text',
  items: 'sale_item_id text, source text, source_record_id uuid, product_id uuid, product_name text, mapping_status text, net_quantity numeric, net_revenue numeric'
};

test('PostgreSQL: every verified identity, renamed catalog, unknowns, nested extras, return and store isolation', {
  skip: !process.env.FOOD_COST_TEST_DATABASE_URL && 'Needs disposable loopback PostgreSQL'
}, async () => {
  const url = new URL(process.env.FOOD_COST_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const sql = postgres(url.href, { max: 1 });
  const c = await sql.reserve();
  const { data, expected } = fixture();
  const values = Object.keys(columns).map(key => JSON.stringify(data[key]));
  const fixtureCtes = Object.entries(columns).map(([table, defs], index) =>
    `fixture_${table} as (select * from jsonb_to_recordset($${index + 1}::text::jsonb) as x(${defs}))`).join(',');
  let query = `with ${fixtureCtes}, fixture_usage as (select null::uuid order_item_id, null::uuid ingredient_id,
    null::numeric quantity_per_item, null::text unit where false), ${PRODUCT_FOOD_COST_CTE}
    select i.sale_item_id, i.product_id, i.net_quantity, i.net_revenue,
      product_cost.is_complete, product_cost.unit_food_cost * i.net_quantity food_cost
    from fixture_items i ${SALE_FOOD_COST_JOIN} order by i.sale_item_id`;
  for (const table of Object.keys(columns).filter(t => t !== 'items')) query = query.replaceAll(`public.${table}`, `fixture_${table}`);
  query = query.replaceAll('public.order_item_ingredient_usage', 'fixture_usage');
  assert.doesNotMatch(query, /public\.|\b(insert|update|delete|create|drop|alter)\b/i);
  try {
    await c.unsafe('begin read only');
    await c.unsafe('set local statement_timeout=10000');
    const rows = await c.unsafe(query, values);
    assert.equal(rows.length, expected.size, 'No duplicate canonical item/cost joins');
    for (const row of rows) {
      const cost = expected.get(row.sale_item_id);
      assert.equal(row.is_complete, cost !== null, row.sale_item_id);
      if (cost !== null) assert.ok(Math.abs(Number(row.food_cost) - cost) < 0.000001, row.sale_item_id);
      else assert.equal(row.food_cost, null, row.sale_item_id);
    }
    const [aggregate] = await c.unsafe(`select
      sum(abs(net_revenue)) filter (where is_complete) covered_turnover,
      sum(food_cost) filter (where is_complete) food_cost,
      count(*) filter (where is_complete and product_id is null) unmapped_costed_rows
      from (${query}) cost_rows`, values);
    assert.equal(Number(aggregate.covered_turnover), data.items
      .filter(item => expected.get(item.sale_item_id) !== null)
      .reduce((sum, item) => sum + Math.abs(item.net_revenue), 0));
    assert.ok(Math.abs(Number(aggregate.food_cost) - [...expected.values()]
      .reduce((sum, cost) => sum + (cost ?? 0), 0)) < 0.000001);
    assert.equal(Number(aggregate.unmapped_costed_rows), 13,
      'Five recipes, six components and their two returns need no catalog product_id');
    for (const invalid of ['zero-price', 'null-price', 'wrong-unit', 'missing-ingredient']) {
      const altered = structuredClone(data.ingredients);
      const ingredient = altered.find(ing => ing.id === rules[0].ingredient_id);
      if (invalid === 'zero-price') ingredient.cost_per_unit = 0;
      if (invalid === 'null-price') ingredient.cost_per_unit = null;
      if (invalid === 'wrong-unit') ingredient.unit = 'pcs';
      const changed = [...values];
      changed[1] = JSON.stringify(invalid === 'missing-ingredient' ? altered.filter(ing => ing.id !== ingredient.id) : altered);
      const result = await c.unsafe(query, changed);
      assert.equal(result.find(row => row.sale_item_id === rules[0].sku).is_complete, false, invalid);
    }
    const expandedRecipe = [...values];
    expandedRecipe[2] = JSON.stringify([...data.product_ingredients, {
      product_id: data.items[0].product_id, ingredient_id: data.ingredients.at(-1).id,
      quantity: 1, unit: data.ingredients.at(-1).unit
    }]);
    const expanded = await c.unsafe(query, expandedRecipe);
    assert.equal(expanded.find(row => row.sale_item_id === rules[0].sku).is_complete, false,
      'A changed portion composition must not inherit an old single-ingredient cost');
    expandedRecipe[2] = JSON.stringify([...data.product_ingredients, {
      product_id: data.items[0].product_id, ingredient_id: data.ingredients.at(-1).id,
      quantity: 0, unit: data.ingredients.at(-1).unit
    }]);
    const optional = await c.unsafe(query, expandedRecipe);
    assert.equal(optional.find(row => row.sale_item_id === rules[0].sku).is_complete, true,
      'Zero-quantity optional ingredients are not part of the sold portion');
  } finally {
    await c.unsafe('rollback'); c.release(); await sql.end();
  }
});
