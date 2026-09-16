import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pricing = JSON.parse(readFileSync("data/catalog/menu-prices-2026-09-16.json", "utf8"));
const hotdogs = JSON.parse(readFileSync("data/catalog/hotdog-variants-2026-09-16.json", "utf8"));
const migration = readFileSync("scripts/apply-runtime-data-migrations.mjs", "utf8");
const overview = readFileSync("src/app/admin/page.tsx", "utf8");
const productActions = readFileSync("src/app/admin/products/actions.ts", "utf8");

test("printed menu pricing updates only the agreed catalog entries", () => {
  const productPrices = Object.fromEntries(pricing.products.map((product) => [product.slug, product.price]));

  assert.deepEqual(productPrices, {
    "firmennaya-shaurma": 590,
    "shaurma-v-lepeshke-kuritsa": 330,
    boxfood: 340,
    aydahobox: 350
  });

  for (const manuallyEditedSlug of ["chickenburger", "chicken-roll", "beef-roll", "tatarin", "mini-shaurma"]) {
    assert.equal(pricing.products.some((product) => product.slug === manuallyEditedSlug), false);
  }
});

test("printed menu portions, box proteins, extras and mixes are represented exactly", () => {
  const portions = Object.fromEntries(pricing.portions.map((portion) => [portion.slug, portion.values]));

  assert.deepEqual(portions["krevetki-v-panirovke"], [{ quantity: 6, price: 390 }, { quantity: 12, price: 730 }]);
  assert.deepEqual(portions["syrnye-palochki"], [{ quantity: 6, price: 320 }, { quantity: 12, price: 590 }]);
  assert.deepEqual(portions.naggetsy, [{ quantity: 6, price: 210 }, { quantity: 12, price: 390 }]);
  assert.deepEqual(portions["krylyshki-barbekyu"], [{ quantity: 8, price: 370 }, { quantity: 16, price: 650 }]);
  assert.deepEqual(portions["kartofel-po-derevenski"], [{ quantity: 150, price: 260 }, { quantity: 200, price: 330 }]);
  assert.deepEqual(portions["kartoshka-fri"], [{ quantity: 150, price: 210 }, { quantity: 200, price: 260 }]);
  assert.equal(pricing.box_variants.length, 2);
  assert.equal(pricing.extras.length, 6);
  assert.deepEqual(pricing.new_products.map((product) => product.price), [540, 530, 490]);

  assert.match(migration, /applyMenuPricing\(transaction\)/);
  assert.match(migration, /data_migration\.menu_prices\.20260916_v1|menuPricing\.migration_marker/);
});

test("owner-approved hotdog variants share recipes and expose the correct required choices", () => {
  assert.deepEqual(hotdogs.existing_products, ["hot-dog-datskiy", "hot-dog-barbekyu", "hot-dog-itali"]);
  assert.deepEqual(
    hotdogs.sausage_group.options.map((option) => [option.label, option.ingredient, option.quantity, option.is_default]),
    [
      ["Свиная", "Колбаска свиная", 1, true],
      ["Куриная", "Колбаска куриная", 1, false],
      ["Говяжья", "Колбаска говяжья", 1, false]
    ]
  );
  assert.equal(hotdogs.frenchdog.slug, "frenchdog");
  assert.deepEqual(
    hotdogs.frenchdog.sauce_group.options.map((option) => [option.label, option.ingredient, option.quantity, option.is_default]),
    [
      ["Кетчуп", "Кетчуп", 30, true],
      ["Чесночный", "Соус чесночный", 30, false],
      ["Сырный", "Соус сырный", 30, false]
    ]
  );
  assert.match(migration, /applyHotdogVariants\(transaction\)/);
  assert.match(migration, /configureReplacementGroup/);
});

test("admin overview is operational and no longer advertises cashier shortcuts", () => {
  for (const moduleName of ["Кухня", "Заказы", "Меню", "Ингредиенты", "Склад", "Экран выдачи", "Производство", "Аналитика"]) {
    assert.match(overview, new RegExp(`title=\"${moduleName}\"`));
  }
  assert.doesNotMatch(overview, /Открыть кухню|Касса|SquareTerminal/);
});

test("product removal archives the catalog row and preserves sales history", () => {
  assert.match(productActions, /from\("products"\)\.update\(\{ is_active: false \}\)\.eq\("id", id\)/);
  assert.match(productActions, /action: "product\.archive"/);
  assert.doesNotMatch(productActions, /from\("products"\)\.delete\(\)/);
});
