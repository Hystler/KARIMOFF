import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

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

test("ingredient nutrition is complete, non-negative, and uses a unit-aware basis", () => {
  const migration = read("supabase/migrations/20260901120000_add_ingredient_nutrition.sql");
  const schema = read("src/lib/ingredient-schema.ts");
  const actions = read("src/app/admin/ingredients/actions.ts");
  const form = read("src/components/admin/IngredientForm.tsx");
  const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");

  for (const column of ["nutrition_basis_quantity", "calories_kcal", "proteins_g", "fats_g", "carbohydrates_g"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
    assert.match(actions + form, new RegExp(column));
  }
  assert.match(migration, /unit = 'pcs' then 1 else 100/);
  assert.match(migration, /ingredients_nutrition_values_check/);
  assert.match(migration, /num_nonnulls\(calories_kcal, proteins_g, fats_g, carbohydrates_g\) = 4/);
  assert.match(migration, /validate constraint ingredients_nutrition_values_check/);
  assert.doesNotMatch(migration, /disable row level security/i);
  assert.match(schema, /Заполните все четыре значения КБЖУ/);
  assert.match(actions, /nutrition_basis_quantity: parsed\.data\.unit === "pcs" \? 1 : 100/);
  assert.match(runtimeMigrations, /20260901120000_add_ingredient_nutrition/);
  assert.match(runtimeMigrations, /ingredients_nutrition_values_check/);
  assert.match(dockerfile, /20260901120000_add_ingredient_nutrition\.sql/);
  assert.match(dockerignore, /!supabase\/migrations\/20260901120000_add_ingredient_nutrition\.sql/);
});

test("recipe nutrition scales grams and pieces without applying kitchen waste twice", () => {
  const moduleUrl = pathToFileURL(join(root, "src/lib/product-nutrition.ts")).href;
  const result = runTypeScript(`
    const { calculateRecipeNutrition } = await import(${JSON.stringify(moduleUrl)});
    const complete = calculateRecipeNutrition([
      { ingredient_id: "a", name: "Курица", sort_order: 10, quantity: 150, unit: "g", nutrition_basis_quantity: 100, calories_kcal: 200, proteins_g: 20, fats_g: 10, carbohydrates_g: 0 },
      { ingredient_id: "b", name: "Булочка", sort_order: 20, quantity: 1, unit: "pcs", nutrition_basis_quantity: 1, calories_kcal: 250, proteins_g: 8, fats_g: 4, carbohydrates_g: 45 }
    ]);
    const incomplete = calculateRecipeNutrition([
      { ingredient_id: "c", name: "Соус", sort_order: 10, quantity: 20, unit: "g", nutrition_basis_quantity: 100, calories_kcal: null, proteins_g: null, fats_g: null, carbohydrates_g: null }
    ]);
    console.log(JSON.stringify({ complete, incomplete }));
  `);

  assert.equal(result.complete.available, true);
  assert.equal(result.complete.items.find((item) => item.key === "calories").value, 550);
  assert.equal(result.complete.items.find((item) => item.key === "protein").value, 38);
  assert.equal(result.incomplete.available, false);
  assert.deepEqual(result.incomplete.missingIngredients, ["Соус"]);
});

test("new product and recipe are created atomically and manual product nutrition is retired", () => {
  const actions = read("src/app/admin/products/actions.ts");
  const form = read("src/components/admin/ProductForm.tsx");
  const composer = read("src/components/admin/ProductRecipeComposer.tsx");

  assert.match(actions, /sql\.begin\(async \(transaction\)/);
  assert.match(actions, /insert into public\.products/);
  assert.match(actions, /insert into public\.product_ingredients/);
  assert.match(actions, /productCompositionDraftSchema/);
  assert.match(actions, /ingredient_count: composition\.data\.length/);
  assert.doesNotMatch(form, /name="(?:calories|protein|fat|carbs)"/);
  assert.match(form, /КБЖУ рассчитывается автоматически/);
  assert.match(composer, /name="composition_json"/);
  assert.match(composer, /Соберите рецептуру до создания товара/);
});

test("empty station is persisted as null and never violates the station check", () => {
  const actions = read("src/app/admin/products/composition-actions.ts");
  assert.match(actions, /station: data\.station \|\| null/);
  assert.doesNotMatch(actions, /insert\(parsed\.data\)/);
});

test("analytics exposes covered gross profit and does not invent food cost for unmapped items", () => {
  const dashboard = read("src/lib/analytics/dashboard.ts");
  const overview = read("src/components/admin/analytics/AnalyticsOverview.tsx");

  assert.match(dashboard, /product_food_costs as/);
  assert.match(dashboard, /ingredient\.waste_percent/);
  assert.match(dashboard, /i\.net_quantity \* product_cost\.unit_food_cost/);
  assert.match(dashboard, /i\.product_id is not null and coalesce\(product_cost\.is_complete, false\)/);
  assert.match(dashboard, /grossProfitAvailable/);
  assert.match(overview, /Валовая прибыль по food cost/);
  assert.match(overview, /покрытие/);
  assert.match(overview, /Food cost/);
  assert.match(overview, /Валовая прибыль/);
  assert.doesNotMatch(overview, /Чистая прибыль/);
});

test("heatmap uses restaurant intervals from 11:00 through 21:00", () => {
  const dashboard = read("src/lib/analytics/dashboard.ts");
  const overview = read("src/components/admin/analytics/AnalyticsOverview.tsx");
  const intelligence = read("src/lib/analytics/intelligence.ts");
  const intelligenceUi = read("src/components/admin/analytics/AnalyticsIntelligenceHub.tsx");
  const filters = read("src/lib/analytics/filters.ts");
  const periods = read("src/lib/analytics/periods.ts");
  const operatingHours = read("src/lib/analytics/operating-hours.ts");
  const styles = read("src/app/globals.css");

  assert.match(dashboard, /between 11 and 20/);
  assert.match(operatingHours, /RESTAURANT_OPEN_HOUR = 11/);
  assert.match(operatingHours, /RESTAURANT_CLOSE_HOUR = 21/);
  assert.match(overview, /OPERATING_INTERVALS/);
  assert.match(overview, /Рабочие интервалы 11:00–21:00/);
  assert.doesNotMatch(overview, /Array\.from\(\{ length: 24 \}/);
  assert.match(intelligence, /OPERATING_HOURS\.map/);
  assert.doesNotMatch(intelligence, /Array\.from\(\{ length: 24 \}/);
  assert.match(intelligenceUi, /Категории по рабочим интервалам/);
  assert.match(filters, /RESTAURANT_OPEN_HOUR, RESTAURANT_CLOSE_HOUR - 1/);
  assert.match(periods, /for \(const hour of OPERATING_HOURS\)/);
  assert.match(periods, /formatOperatingInterval/);
  assert.match(styles, /repeat\(10, minmax\(52px, 1fr\)\)/);
});

test("dayparts are restricted to the restaurant operating window", () => {
  const intelligence = read("src/lib/analytics/intelligence.ts");
  const intelligenceUi = read("src/components/admin/analytics/AnalyticsIntelligenceHub.tsx");

  assert.match(intelligence, /label: "Обед", start: 11, end: 14/);
  assert.match(intelligence, /label: "День", start: 14, end: 17/);
  assert.match(intelligence, /label: "Вечер", start: 17, end: 21/);
  assert.doesNotMatch(intelligence, /start: 0, end: 11/);
  assert.doesNotMatch(intelligence, /start: 21, end: 24/);
  assert.match(intelligence, /min\(RESTAURANT_OPEN_HOUR\)/);
  assert.match(intelligence, /max\(RESTAURANT_CLOSE_HOUR\)/);
  assert.match(intelligenceUi, /Спрос по рабочему времени/);
  assert.match(intelligenceUi, /Нажатие применяет категорию ко всему отчёту/);
});

test("explicit Evotor aliases confirm only recipe-equivalent products", () => {
  const mappings = JSON.parse(read("data/analytics/evotor-product-mappings.json"));
  const techCard = JSON.parse(read("data/tech-cards/karimoff-tech-card-2026-08-11.json"));
  const catalog = JSON.parse(read("data/import/juikaifui-products.json"));
  const sync = read("src/lib/integrations/evotor/sync.ts");
  const runtimeMigration = read("scripts/apply-runtime-data-migrations.mjs");
  const dockerfile = read("Dockerfile");
  const knownSlugs = new Set([
    ...catalog.map((product) => product.slug),
    ...techCard.recipes.flatMap((recipe) => recipe.product_slugs)
  ]);
  const normalizedNames = mappings.flatMap((mapping) => mapping.evotor_names)
    .map((name) => name.normalize("NFKC").replaceAll("ё", "е").trim().toLowerCase());

  assert.equal(new Set(normalizedNames).size, normalizedNames.length);
  for (const mapping of mappings) {
    assert.ok(mapping.product_slugs.some((slug) => knownSlugs.has(slug)), mapping.product_slugs[0]);
  }

  for (const expected of [
    "Шаурма в лаваше с курицей",
    "Кантри Биф",
    "Айдахо Бокс с курицей",
    "Хот-дог Датский Свинина",
    "Королевские креветки в панировке 6 шт.",
    "Картофель фри 150 гр."
  ]) {
    assert.ok(mappings.some((mapping) => mapping.evotor_names.includes(expected)), expected);
  }

  for (const unsafe of [
    "Хот-дог Датский Курица",
    "Хот-дог Датский Говядина",
    "Картофель фри 200 гр.",
    "Сырные палочки 6 шт.",
    "Айдахо Бокс с говядиной"
  ]) {
    assert.ok(!mappings.some((mapping) => mapping.evotor_names.includes(unsafe)), unsafe);
  }

  assert.match(sync, /EXPLICIT_EVOTOR_PRODUCT_MAPPINGS/);
  assert.match(sync, /system:explicit-catalog-alias/);
  assert.match(sync, /status = 'suggested'/);
  assert.match(runtimeMigration, /applyExplicitEvotorMappings/);
  assert.match(runtimeMigration, /confirmedMappings/);
  assert.match(dockerfile, /data\/analytics/);
});
