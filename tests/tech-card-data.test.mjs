import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const data = JSON.parse(
  readFileSync(new URL("../data/tech-cards/karimoff-tech-card-2026-08-11.json", import.meta.url), "utf8")
);
const catalog = JSON.parse(
  readFileSync(new URL("../data/import/juikaifui-products.json", import.meta.url), "utf8")
);
const runtimeMigration = readFileSync(
  new URL("../scripts/apply-runtime-data-migrations.mjs", import.meta.url),
  "utf8"
);
const economicsPage = readFileSync(
  new URL("../src/app/admin/economics/page.tsx", import.meta.url),
  "utf8"
);

const normalizeName = (value) =>
  String(value)
    .normalize("NFKC")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .toLowerCase();

test("technical card data has stable unique references", () => {
  assert.equal(data.ingredients.length, 44);
  assert.equal(new Set(data.ingredients.map((ingredient) => ingredient.key)).size, data.ingredients.length);
  assert.equal(data.recipes.length, 40);
  assert.equal(new Set(data.recipes.map((recipe) => recipe.product_slugs[0])).size, data.recipes.length);
  assert.equal(data.pending_source_recipes.length, 16);
  assert.equal(data.catalog_products_without_confirmed_recipe.length, 0);
  assert.equal(data.inactive_product_slugs.length, 8);
  assert.equal(new Set(data.inactive_product_slugs).size, data.inactive_product_slugs.length);
  assert.equal(data.catalog_product_defaults.length, 7);
  assert.equal(
    new Set(data.catalog_product_defaults.map((product) => product.slug)).size,
    data.catalog_product_defaults.length
  );
});

test("every recipe line references a supported ingredient and positive quantity", () => {
  const ingredients = new Map(data.ingredients.map((ingredient) => [ingredient.key, ingredient]));
  const supportedUnits = new Set(["g", "ml", "pcs"]);

  for (const ingredient of data.ingredients) {
    assert.ok(supportedUnits.has(ingredient.unit), `Unsupported unit for ${ingredient.key}`);
  }

  for (const recipe of data.recipes) {
    assert.ok(recipe.lines.length > 0, `Empty recipe for ${recipe.product_slugs[0]}`);
    for (const line of recipe.lines) {
      assert.ok(ingredients.has(line.ingredient), `Unknown ingredient ${line.ingredient}`);
      assert.ok(Number.isFinite(line.quantity) && line.quantity > 0, `Invalid quantity in ${recipe.product_slugs[0]}`);
    }
  }

  assert.equal(data.recipes.flatMap((recipe) => recipe.lines).length, 164);
});

test("only confirmed product mappings are imported", () => {
  assert.equal(data.recipes.filter((recipe) => recipe.source_kind === "technical_card").length, 20);
  assert.equal(data.recipes.filter((recipe) => recipe.source_kind === "catalog_purchase_unit").length, 20);

  const danishHotDog = data.recipes.find((recipe) => recipe.product_slugs.includes("hot-dog-datskiy"));
  assert.ok(danishHotDog);
  assert.ok(danishHotDog.lines.some((line) => line.ingredient === "pork_sausage"));
  assert.ok(!danishHotDog.lines.some((line) => line.ingredient === "beef_sausage"));

  assert.ok(data.pending_source_recipes.some((name) => name.includes("говяжьей колбаской")));
  assert.ok(data.pending_source_recipes.some((name) => name.startsWith("Френчдог")));
  assert.ok(data.recipes.some((recipe) => recipe.product_slugs.includes("kantrigrand")));
});

test("every current catalog product has exactly one base recipe", () => {
  for (const product of catalog) {
    const matches = data.recipes.filter(
      (recipe) =>
        recipe.product_slugs.some((slug) => normalizeName(slug) === normalizeName(product.slug)) ||
        recipe.product_names.some((name) => normalizeName(name) === normalizeName(product.name))
    );

    assert.equal(matches.length, 1, `${product.slug} must have exactly one base recipe`);
  }
});

test("owner pricing and kitchen waste assumptions are explicit", () => {
  const ingredients = new Map(data.ingredients.map((ingredient) => [ingredient.key, ingredient]));
  const expected = {
    cabbage: { package_size: 1000, package_price: 35, waste_percent: 20 },
    tomato: { package_size: 1000, package_price: 140, waste_percent: 5 },
    cucumber: { package_size: 1000, package_price: 85, waste_percent: 5 },
    onion: { package_size: 1000, package_price: 130, waste_percent: 5 },
    fried_onion: { package_size: 1000, package_price: 512, waste_percent: 0 },
    pickle: { package_size: 3000, package_price: 399, waste_percent: 52.5 },
    ketchup: { package_size: 1000, package_price: 228, waste_percent: 0 },
    cheese_sauce: { package_size: 1000, package_price: 292, waste_percent: 0 },
    honey_mustard: { package_size: 1000, package_price: 369, waste_percent: 0 },
    bacon: { package_size: 1, package_price: 4.8, waste_percent: 0 },
    lettuce: { package_size: 100, package_price: 100, waste_percent: 20 },
    bbq_sauce: { package_size: 150, package_price: 80, waste_percent: 0 },
    garlic_sauce: { package_size: 150, package_price: 80, waste_percent: 0 },
    caesar_sauce: { package_size: 150, package_price: 80, waste_percent: 0 },
    tasty_sauce: { package_size: 150, package_price: 80, waste_percent: 0 }
  };

  for (const [key, pricing] of Object.entries(expected)) {
    assert.deepEqual(
      {
        package_size: ingredients.get(key)?.package_size,
        package_price: ingredients.get(key)?.package_price,
        waste_percent: ingredients.get(key)?.waste_percent
      },
      pricing,
      key
    );
  }
});

test("all active menu products have complete food cost inputs and drinks are hidden", () => {
  const ingredients = new Map(data.ingredients.map((ingredient) => [ingredient.key, ingredient]));
  const inactiveSlugs = new Set(data.inactive_product_slugs);
  const activeProducts = catalog.filter((product) => product.is_active);

  assert.equal(activeProducts.length, 32);
  assert.equal(catalog.filter((product) => product.category === "Напитки" && product.is_active).length, 0);

  for (const slug of inactiveSlugs) {
    const product = catalog.find((entry) => entry.slug === slug);
    assert.ok(product, `Missing inactive product ${slug}`);
    assert.equal(product.is_active, false, `${slug} must be hidden`);
  }

  for (const product of activeProducts) {
    const recipe = data.recipes.find(
      (entry) =>
        entry.product_slugs.some((slug) => normalizeName(slug) === normalizeName(product.slug)) ||
        entry.product_names.some((name) => normalizeName(name) === normalizeName(product.name))
    );
    assert.ok(recipe, `Missing recipe for ${product.slug}`);

    for (const line of recipe.lines) {
      const ingredient = ingredients.get(line.ingredient);
      assert.ok(ingredient?.package_size > 0, `Missing package size for ${line.ingredient} in ${product.slug}`);
      assert.ok(ingredient?.package_price > 0, `Missing package price for ${line.ingredient} in ${product.slug}`);
    }
  }
});

test("technical card does not invent paid extras", () => {
  for (const line of data.recipes.flatMap((recipe) => recipe.lines)) {
    assert.equal("extra_price" in line, false);
    assert.equal("is_extra_available" in line, false);
  }
});

test("standalone snack recipes match the active production portions", () => {
  const quantityFor = (slug, ingredient) =>
    data.recipes
      .find((recipe) => recipe.product_slugs.includes(slug))
      ?.lines.find((line) => line.ingredient === ingredient)?.quantity;

  assert.equal(quantityFor("krevetki-v-panirovke", "breaded_shrimp"), 6);
  assert.equal(quantityFor("naggetsy-6-sht", "nugget"), 6);
  assert.equal(quantityFor("syrnye-palochki-12-sht", "cheese_stick"), 12);
  assert.equal(quantityFor("kartofel-po-derevenski", "country_potatoes"), 150);
  assert.equal(quantityFor("kartoshka-fri", "fries"), 150);
  assert.equal(quantityFor("krylyshki-barbekyu", "bbq_wing"), 16);
});

test("runtime migration applies source pricing atomically and keeps an audit snapshot", () => {
  assert.match(runtimeMigration, /update public\.ingredients/);
  assert.match(runtimeMigration, /cost_per_unit = \$\{pricing\?\.costPerUnit/);
  assert.match(runtimeMigration, /waste_percent = \$\{wastePercent/);
  assert.match(runtimeMigration, /previous_ingredient_pricing/);
  assert.match(runtimeMigration, /previous_product_availability/);
  assert.match(runtimeMigration, /created_products/);
  assert.match(runtimeMigration, /insert into public\.products/);
  assert.match(runtimeMigration, /recipe \? resolveProduct\(recipe, products\) : null/);
  assert.match(runtimeMigration, /set is_active = false/);
  assert.match(runtimeMigration, /pg_advisory_xact_lock/);
});

test("runtime migration resolves the current production aliases and creates only missing canonical products", () => {
  const productionSlugs = [
    "rokki", "sebastian", "borak-abama", "voin-drakona", "kantribif", "tayson",
    "firmennaya-shaurma", "shaurma-v-lepeshke-govyadina", "shaurma-v-lepeshke-svinina",
    "shaurma-v-lepeshke-kuritsa", "shaurma-krevetka", "shaurma-zapechennaya-govyadina",
    "shaurma-zapechennaya-svinina", "shaurma-kurinaya", "hot-dog-barbekyu", "hot-dog-itali",
    "hot-dog-datskiy", "aydahobox", "boxfood", "krevetki-v-panirovke", "naggetsy",
    "syrnye-palochki", "kartofel-po-derevenski", "kartoshka-fri", "krylyshki-barbekyu",
    "dobryy-apelsin-1l", "dobryy-kola-1l", "dobryy-kola-zero-1l", "dobryy-kola-zero-05",
    "dobryy-kola-05", "dobryy-apelsin-05", "dobryy-apelsin-can-033", "dobryy-kola-zero-can-033"
  ];
  const productionNameOverrides = {
    "krevetki-v-panirovke": "Королевские креветки",
    naggetsy: "Наггетсы",
    "syrnye-palochki": "Сырные палочки",
    "kartoshka-fri": "Картофель фри",
    "krylyshki-barbekyu": "Крылышки барбекю"
  };
  const productionProducts = productionSlugs.map((slug) => ({
    slug,
    name: productionNameOverrides[slug] ?? slug
  }));
  const catalogDefaults = new Set(data.catalog_product_defaults.map((product) => normalizeName(product.slug)));
  const missingRecipes = [];

  for (const recipe of data.recipes) {
    const slugs = new Set(recipe.product_slugs.map(normalizeName));
    const names = new Set(recipe.product_names.map(normalizeName));
    const found = productionProducts.some(
      (product) => slugs.has(normalizeName(product.slug)) || names.has(normalizeName(product.name))
    );
    if (!found) {
      missingRecipes.push(recipe.product_slugs.find((slug) => catalogDefaults.has(normalizeName(slug))));
    }
  }

  assert.deepEqual(
    missingRecipes.sort(),
    data.catalog_product_defaults.map((product) => product.slug).sort()
  );

  for (const inactiveSlug of data.inactive_product_slugs) {
    const recipe = data.recipes.find((entry) => entry.product_slugs.includes(inactiveSlug));
    assert.ok(recipe);
    assert.ok(
      productionProducts.some((product) => recipe.product_slugs.includes(product.slug)),
      `${inactiveSlug} must resolve through its production alias`
    );
  }
});

test("admin economics distinguishes gross profit from net profit and ranks complete active products", () => {
  assert.match(economicsPage, /Валовая прибыль с единицы/);
  assert.match(economicsPage, /а не чистая прибыль бизнеса/);
  assert.match(economicsPage, /Лучшая прибыль с единицы/);
  assert.match(economicsPage, /Лучшая валовая маржа/);
  assert.match(economicsPage, /item\.product\.is_active/);
  assert.match(economicsPage, /item\.is_complete/);
});
