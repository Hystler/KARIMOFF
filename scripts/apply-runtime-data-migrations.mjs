import { readFileSync } from "node:fs";
import postgres from "postgres";

const dataPath = new URL("../data/tech-cards/karimoff-tech-card-2026-08-11.json", import.meta.url);
const mappingPath = new URL("../data/analytics/evotor-product-mappings.json", import.meta.url);
const techCard = JSON.parse(readFileSync(dataPath, "utf8"));
const explicitMappingRules = JSON.parse(readFileSync(mappingPath, "utf8"));
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

function validateExplicitMappingRules() {
  const claimedNames = new Set();
  for (const rule of explicitMappingRules) {
    if (!rule.product_slugs?.length || !rule.evotor_names?.length) {
      throw new Error("Every explicit Evotor mapping must have product slugs and source names.");
    }
    for (const name of rule.evotor_names) {
      const normalized = normalizeName(name);
      if (!normalized || claimedNames.has(normalized)) {
        throw new Error(`Invalid or duplicate explicit Evotor mapping: ${name}`);
      }
      claimedNames.add(normalized);
    }
  }
}

async function applyExplicitEvotorMappings(transaction) {
  let confirmedMappings = 0;

  for (const rule of explicitMappingRules) {
    const targets = await transaction`
      select id
      from public.products
      where slug = any(${rule.product_slugs}::text[])
      order by array_position(${rule.product_slugs}::text[], slug)
      limit 2
    `;
    if (targets.length !== 1) {
      throw new Error(`Explicit Evotor mapping target is missing or ambiguous: ${rule.product_slugs[0]}`);
    }

    const normalizedNames = rule.evotor_names.map((name) =>
      String(name).normalize("NFKC").replaceAll("ё", "е").trim().toLowerCase()
    );
    const changed = await transaction`
      insert into public.evotor_product_mappings (
        evotor_product_id,
        karimoff_product_id,
        status,
        match_method,
        confidence,
        confirmed_by,
        confirmed_at
      )
      select
        product.id,
        ${targets[0].id}::uuid,
        'confirmed',
        'manual',
        1,
        'system:explicit-catalog-alias',
        now()
      from public.evotor_products product
      where replace(lower(trim(product.name)), 'ё', 'е') = any(${normalizedNames}::text[])
      on conflict (evotor_product_id) do update
      set
        status = 'confirmed',
        match_method = 'manual',
        confidence = 1,
        confirmed_by = 'system:explicit-catalog-alias',
        confirmed_at = now(),
        updated_at = now()
      where public.evotor_product_mappings.status = 'suggested'
        and public.evotor_product_mappings.karimoff_product_id = excluded.karimoff_product_id
      returning id
    `;
    confirmedMappings += changed.length;
  }

  return confirmedMappings;
}

function getIngredientPricing(ingredient) {
  const hasPackageSize = ingredient.package_size !== undefined;
  const hasPackagePrice = ingredient.package_price !== undefined;

  if (hasPackageSize !== hasPackagePrice) {
    throw new Error(`Package size and price must be set together for ${ingredient.key}`);
  }

  if (!hasPackageSize) {
    return null;
  }

  const packageSize = Number(ingredient.package_size);
  const packagePrice = Number(ingredient.package_price);

  if (!Number.isFinite(packageSize) || packageSize <= 0 || !Number.isFinite(packagePrice) || packagePrice < 0) {
    throw new Error(`Invalid package pricing for ${ingredient.key}`);
  }

  return {
    packageSize,
    packagePrice,
    costPerUnit: packagePrice / packageSize
  };
}

function validateTechCard() {
  const ingredientKeys = new Set();
  const recipeProducts = new Set();
  const inactiveProductSlugs = new Set();
  const catalogProductSlugs = new Set();

  for (const slug of techCard.inactive_product_slugs ?? []) {
    const normalizedSlug = normalizeName(slug);
    if (!normalizedSlug || inactiveProductSlugs.has(normalizedSlug)) {
      throw new Error(`Invalid or duplicate inactive product slug: ${slug}`);
    }
    inactiveProductSlugs.add(normalizedSlug);
  }

  for (const product of techCard.catalog_product_defaults ?? []) {
    const normalizedSlug = normalizeName(product.slug);
    if (!normalizedSlug || catalogProductSlugs.has(normalizedSlug)) {
      throw new Error(`Invalid or duplicate catalog product slug: ${product.slug}`);
    }
    if (
      !product.name ||
      !product.category ||
      !product.description ||
      !Number.isFinite(Number(product.price)) ||
      Number(product.price) < 0 ||
      !Number.isFinite(Number(product.sort_order))
    ) {
      throw new Error(`Invalid catalog product defaults: ${product.slug}`);
    }
    catalogProductSlugs.add(normalizedSlug);
  }

  for (const ingredient of techCard.ingredients) {
    if (ingredientKeys.has(ingredient.key)) {
      throw new Error(`Duplicate ingredient key: ${ingredient.key}`);
    }
    if (!["g", "ml", "pcs"].includes(ingredient.unit)) {
      throw new Error(`Unsupported unit for ${ingredient.key}: ${ingredient.unit}`);
    }
    getIngredientPricing(ingredient);
    if (
      ingredient.waste_percent !== undefined &&
      (!Number.isFinite(Number(ingredient.waste_percent)) || Number(ingredient.waste_percent) < 0 || Number(ingredient.waste_percent) > 95)
    ) {
      throw new Error(`Invalid waste percent for ${ingredient.key}`);
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

  for (const product of techCard.catalog_product_defaults ?? []) {
    const hasRecipe = techCard.recipes.some((recipe) =>
      recipe.product_slugs.some((slug) => normalizeName(slug) === normalizeName(product.slug))
    );
    if (!hasRecipe) {
      throw new Error(`Catalog product has no recipe: ${product.slug}`);
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
validateExplicitMappingRules();

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
      select id, name, slug, is_active
      from public.products
      order by sort_order, name
      for update
    `;
    const productByRecipe = new Map();
    const unresolvedProducts = [];
    const createdProducts = [];
    const catalogProductDefaults = new Map(
      (techCard.catalog_product_defaults ?? []).map((product) => [normalizeName(product.slug), product])
    );

    for (const recipe of techCard.recipes) {
      let product = resolveProduct(recipe, products);
      if (!product) {
        const defaults = recipe.product_slugs
          .map((slug) => catalogProductDefaults.get(normalizeName(slug)))
          .find(Boolean);

        if (!defaults) {
          unresolvedProducts.push(recipe.product_names[0] ?? recipe.product_slugs[0]);
          continue;
        }

        [product] = await transaction`
          insert into public.products (
            slug, name, category, description, price, image_url, is_active, sort_order, weight
          )
          values (
            ${defaults.slug},
            ${defaults.name},
            ${defaults.category},
            ${defaults.description},
            ${defaults.price},
            ${defaults.image_url ?? null},
            true,
            ${defaults.sort_order},
            ${defaults.weight ?? null}
          )
          returning id, name, slug, is_active
        `;
        products.push(product);
        createdProducts.push({ id: product.id, slug: product.slug });
      }

      productByRecipe.set(recipe, product);
    }

    if (unresolvedProducts.length) {
      throw new Error(`Products are missing: ${unresolvedProducts.join(", ")}`);
    }

    const productsBySlug = new Map(products.map((product) => [normalizeName(product.slug), product]));
    const inactiveProducts = (techCard.inactive_product_slugs ?? []).map((slug) => {
      const exactProduct = productsBySlug.get(normalizeName(slug));
      if (exactProduct) {
        return exactProduct;
      }

      const recipe = techCard.recipes.find((item) =>
        item.product_slugs.some((candidate) => normalizeName(candidate) === normalizeName(slug))
      );
      return recipe ? resolveProduct(recipe, products) : null;
    });
    const missingInactiveProducts = (techCard.inactive_product_slugs ?? []).filter(
      (_, index) => !inactiveProducts[index]
    );

    if (missingInactiveProducts.length) {
      throw new Error(`Products to deactivate are missing: ${missingInactiveProducts.join(", ")}`);
    }

    const previousProductAvailability = inactiveProducts.map((product) => ({
      id: product.id,
      slug: product.slug,
      is_active: product.is_active
    }));

    if (inactiveProducts.length) {
      await transaction`
        update public.products
        set is_active = false, updated_at = now()
        where id = any(${inactiveProducts.map((product) => product.id)}::uuid[])
      `;
    }

    const existingIngredients = await transaction`
      select id, name, category, unit, cost_per_unit, waste_percent, package_size, package_price, sort_order
      from public.ingredients
      order by sort_order, name
      for update
    `;
    const ingredientByKey = new Map();
    let createdIngredients = 0;
    let updatedIngredients = 0;
    const previousIngredientPricing = [];

    for (const spec of techCard.ingredients) {
      let ingredient = resolveIngredient(spec, existingIngredients);
      const pricing = getIngredientPricing(spec);
      const wastePercent = spec.waste_percent === undefined ? null : Number(spec.waste_percent);

      if (!ingredient) {
        [ingredient] = await transaction`
          insert into public.ingredients (
            name, category, unit, cost_per_unit, waste_percent, package_size, package_price, is_active, sort_order
          )
          values (
            ${spec.name},
            ${spec.category},
            ${spec.unit},
            ${pricing?.costPerUnit ?? 0},
            ${wastePercent ?? 0},
            ${pricing?.packageSize ?? null},
            ${pricing?.packagePrice ?? null},
            true,
            ${spec.sort_order}
          )
          returning id, name, category, unit, cost_per_unit, waste_percent, package_size, package_price, sort_order
        `;
        existingIngredients.push(ingredient);
        createdIngredients += 1;
      } else {
        previousIngredientPricing.push({
          id: ingredient.id,
          name: ingredient.name,
          cost_per_unit: ingredient.cost_per_unit,
          waste_percent: ingredient.waste_percent,
          package_size: ingredient.package_size,
          package_price: ingredient.package_price
        });

        [ingredient] = await transaction`
          update public.ingredients
          set
            name = ${spec.name},
            category = ${spec.category},
            cost_per_unit = ${pricing?.costPerUnit ?? ingredient.cost_per_unit},
            waste_percent = ${wastePercent ?? ingredient.waste_percent},
            package_size = ${pricing?.packageSize ?? ingredient.package_size},
            package_price = ${pricing?.packagePrice ?? ingredient.package_price},
            sort_order = ${spec.sort_order},
            updated_at = now()
          where id = ${ingredient.id}
          returning id, name, category, unit, cost_per_unit, waste_percent, package_size, package_price, sort_order
        `;
        const ingredientIndex = existingIngredients.findIndex((item) => item.id === ingredient.id);
        existingIngredients[ingredientIndex] = ingredient;
        updatedIngredients += 1;
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
      if (!product) {
        throw new Error(`Resolved product is missing for ${recipe.product_slugs[0]}`);
      }

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
          recipe_count: productByRecipe.size,
          created_products: createdProducts,
          ingredient_count: techCard.ingredients.length,
          created_ingredients: createdIngredients,
          updated_ingredients: updatedIngredients,
          inserted_lines: insertedLines,
          deactivated_product_count: inactiveProducts.length,
          previous_product_availability: previousProductAvailability,
          previous_ingredient_pricing: previousIngredientPricing,
          previous_composition: previousComposition
        })},
        'scripts/apply-runtime-data-migrations.mjs'
      )
    `;

    return {
      status: "applied",
      recipes: productByRecipe.size,
      createdProducts: createdProducts.length,
      ingredients: techCard.ingredients.length,
      createdIngredients,
      updatedIngredients,
      insertedLines,
      deactivatedProducts: inactiveProducts.length,
      previousLines: previousComposition.length
    };
  });

  const confirmedMappings = await sql.begin(applyExplicitEvotorMappings);

  console.log(`Runtime data migration ${techCard.version}: ${JSON.stringify({ ...result, confirmedMappings })}`);
} finally {
  await sql.end({ timeout: 2 });
}
