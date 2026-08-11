import { readFileSync } from "node:fs";
import postgres from "postgres";

const dataPath = new URL("../data/tech-cards/karimoff-tech-card-2026-08-11.json", import.meta.url);
const techCard = JSON.parse(readFileSync(dataPath, "utf8"));
const databaseUrl = process.env.DATABASE_URL;

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replaceAll("ё", "е")
    .replaceAll("Ё", "Е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function validateTechCard() {
  const ingredientKeys = new Set();
  const recipeProducts = new Set();

  for (const ingredient of techCard.ingredients) {
    if (ingredientKeys.has(ingredient.key)) {
      throw new Error(`Duplicate ingredient key: ${ingredient.key}`);
    }
    if (!["g", "ml", "pcs"].includes(ingredient.unit)) {
      throw new Error(`Unsupported unit for ${ingredient.key}: ${ingredient.unit}`);
    }
    ingredientKeys.add(ingredient.key);
  }

  for (const recipe of techCard.recipes) {
    const recipeKey = recipe.product_slugs[0] || recipe.product_names[0];
    if (recipeProducts.has(recipeKey)) {
      throw new Error(`Duplicate recipe mapping: ${recipeKey}`);
    }
    recipeProducts.add(recipeKey);

    if (!recipe.lines.length) {
      throw new Error(`Recipe has no lines: ${recipeKey}`);
    }

    for (const line of recipe.lines) {
      if (!ingredientKeys.has(line.ingredient)) {
        throw new Error(`Unknown ingredient ${line.ingredient} in ${recipeKey}`);
      }
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new Error(`Invalid quantity for ${line.ingredient} in ${recipeKey}`);
      }
    }
  }
}

function resolveProduct(recipe, products) {
  const slugs = new Set(recipe.product_slugs.map((value) => normalizeName(value)));
  const names = new Set(recipe.product_names.map((value) => normalizeName(value)));

  return (
    products.find((product) => slugs.has(normalizeName(product.slug))) ??
    products.find((product) => names.has(normalizeName(product.name))) ??
    null
  );
}

function resolveIngredient(spec, ingredients) {
  const acceptedNames = new Set([spec.name, ...(spec.aliases ?? [])].map(normalizeName));
  return (
    ingredients.find(
      (ingredient) =>
        ingredient.unit === spec.unit && normalizeName(ingredient.name) === normalizeName(spec.name)
    ) ??
    ingredients.find(
      (ingredient) => ingredient.unit === spec.unit && acceptedNames.has(normalizeName(ingredient.name))
    ) ??
    null
  );
}

validateTechCard();

if (!databaseUrl) {
  console.log("Runtime data migrations skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 5,
  max: 1,
  prepare: false
});

try {
  const result = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${techCard.migration_marker}))`;

    const [existingMarker] = await transaction`
      select id
      from public.audit_logs
      where action = ${techCard.migration_marker}
      limit 1
    `;

    if (existingMarker) {
      return { status: "already_applied" };
    }

    const products = await transaction`
      select id, name, slug
      from public.products
      order by sort_order, name
      for update
    `;
    const productByRecipe = new Map();
    const unresolvedProducts = [];

    for (const recipe of techCard.recipes) {
      const product = resolveProduct(recipe, products);
      if (!product) {
        unresolvedProducts.push(recipe.product_names[0] ?? recipe.product_slugs[0]);
      } else {
        productByRecipe.set(recipe, product);
      }
    }

    if (unresolvedProducts.length) {
      throw new Error(`Products are missing: ${unresolvedProducts.join(", ")}`);
    }

    const existingIngredients = await transaction`
      select id, name, unit, cost_per_unit, package_size, package_price
      from public.ingredients
      order by sort_order, name
      for update
    `;
    const ingredientByKey = new Map();
    let createdIngredients = 0;

    for (const spec of techCard.ingredients) {
      let ingredient = resolveIngredient(spec, existingIngredients);

      if (!ingredient) {
        [ingredient] = await transaction`
          insert into public.ingredients (
            name, category, unit, cost_per_unit, package_size, package_price, is_active, sort_order
          )
          values (
            ${spec.name}, ${spec.category}, ${spec.unit}, 0, null, null, true, ${spec.sort_order}
          )
          returning id, name, unit, cost_per_unit, package_size, package_price
        `;
        existingIngredients.push(ingredient);
        createdIngredients += 1;
      }

      ingredientByKey.set(spec.key, ingredient);

      await transaction`
        insert into public.inventory_items (
          ingredient_id, current_quantity, reserved_quantity, min_quantity, unit, is_active
        )
        values (${ingredient.id}, 0, 0, 0, ${spec.unit}, true)
        on conflict (ingredient_id) do nothing
      `;
    }

    const productIds = Array.from(productByRecipe.values(), (product) => product.id);
    const previousComposition = await transaction`
      select
        product_id,
        ingredient_id,
        quantity,
        unit,
        sort_order,
        is_removable,
        is_extra_available,
        extra_quantity,
        extra_price,
        max_extra_quantity
      from public.product_ingredients
      where product_id = any(${productIds}::uuid[])
      order by product_id, sort_order
    `;

    await transaction`
      delete from public.product_ingredients
      where product_id = any(${productIds}::uuid[])
    `;

    let insertedLines = 0;
    for (const recipe of techCard.recipes) {
      const product = productByRecipe.get(recipe);

      for (const [lineIndex, line] of recipe.lines.entries()) {
        const ingredient = ingredientByKey.get(line.ingredient);
        const spec = techCard.ingredients.find((item) => item.key === line.ingredient);

        await transaction`
          insert into public.product_ingredients (
            product_id,
            ingredient_id,
            quantity,
            unit,
            sort_order,
            is_removable,
            is_extra_available,
            extra_quantity,
            extra_price,
            max_extra_quantity
          )
          values (
            ${product.id},
            ${ingredient.id},
            ${line.quantity},
            ${spec.unit},
            ${(lineIndex + 1) * 10},
            ${line.removable === true},
            false,
            0,
            0,
            1
          )
        `;
        insertedLines += 1;
      }
    }

    const [{ count: verifiedLines }] = await transaction`
      select count(*)::int as count
      from public.product_ingredients
      where product_id = any(${productIds}::uuid[])
    `;

    if (Number(verifiedLines) !== insertedLines) {
      throw new Error(`Composition verification failed: expected ${insertedLines}, got ${verifiedLines}`);
    }

    await transaction`
      insert into public.audit_logs (
        actor_type,
        action,
        entity_type,
        entity_id,
        metadata,
        source_path
      )
      values (
        'system',
        ${techCard.migration_marker},
        'technical_card',
        ${techCard.version},
        ${transaction.json({
          source_document: techCard.source_document,
          recipe_count: techCard.recipes.length,
          ingredient_count: techCard.ingredients.length,
          created_ingredients: createdIngredients,
          inserted_lines: insertedLines,
          previous_composition: previousComposition
        })},
        'scripts/apply-runtime-data-migrations.mjs'
      )
    `;

    return {
      status: "applied",
      recipes: techCard.recipes.length,
      ingredients: techCard.ingredients.length,
      createdIngredients,
      insertedLines,
      previousLines: previousComposition.length
    };
  });

  console.log(`Runtime data migration ${techCard.version}: ${JSON.stringify(result)}`);
} finally {
  await sql.end({ timeout: 2 });
}
