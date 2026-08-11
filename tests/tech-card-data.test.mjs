import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const data = JSON.parse(
  readFileSync(new URL("../data/tech-cards/karimoff-tech-card-2026-08-11.json", import.meta.url), "utf8")
);

test("technical card data has stable unique references", () => {
  assert.equal(data.ingredients.length, 38);
  assert.equal(new Set(data.ingredients.map((ingredient) => ingredient.key)).size, data.ingredients.length);
  assert.equal(data.recipes.length, 27);
  assert.equal(new Set(data.recipes.map((recipe) => recipe.product_slugs[0])).size, data.recipes.length);
  assert.equal(data.pending_source_recipes.length, 16);
  assert.equal(data.catalog_products_without_confirmed_recipe.length, 6);
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

  assert.equal(data.recipes.flatMap((recipe) => recipe.lines).length, 151);
});

test("only confirmed product mappings are imported", () => {
  assert.equal(data.recipes.filter((recipe) => recipe.source_kind === "technical_card").length, 20);
  assert.equal(data.recipes.filter((recipe) => recipe.source_kind === "catalog_purchase_unit").length, 7);

  const danishHotDog = data.recipes.find((recipe) => recipe.product_slugs.includes("hot-dog-datskiy"));
  assert.ok(danishHotDog);
  assert.ok(danishHotDog.lines.some((line) => line.ingredient === "pork_sausage"));
  assert.ok(!danishHotDog.lines.some((line) => line.ingredient === "beef_sausage"));

  assert.ok(data.pending_source_recipes.some((name) => name.includes("говяжьей колбаской")));
  assert.ok(data.pending_source_recipes.some((name) => name.startsWith("Френчдог")));
});

test("technical card does not invent paid extras", () => {
  for (const line of data.recipes.flatMap((recipe) => recipe.lines)) {
    assert.equal("extra_price" in line, false);
    assert.equal("is_extra_available" in line, false);
  }
});
