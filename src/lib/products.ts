import "server-only";

import { demoProducts } from "@/data/products";
import { resolvePublicMediaUrl } from "@/lib/media-url";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { isPublicMenuCategory } from "@/lib/product-categories";
import { formatServing, normalizeServing, getPortionGroup } from "./product-serving";
import { getProductAliases } from "./product-portions";
import type {
  Product,
  ProductCompositionItem,
  ProductImage,
  ProductModifierGroup,
  ProductModifierGroupOption,
  ProductModifierOption
} from "./product-types";

const PRODUCT_SELECT =
  "id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags, calories, protein, fat, carbs, allergens";

export function isPublicMenuProduct(product: Pick<Product, "category">) {
  return isPublicMenuCategory(product.category);
}

export const fallbackProducts: Product[] = demoProducts.filter(isPublicMenuProduct);

const fallbackBySlug = new Map(fallbackProducts.map((product) => [product.slug, product]));
const fallbackActiveProducts = fallbackProducts.filter((product) => product.is_active);
const fallbackActiveBySlug = new Map(fallbackActiveProducts.map((product) => [product.slug, product]));
const fallbackByName = new Map(fallbackProducts.map((product) => [normalizeProductName(product.name), product]));

function normalizeProductName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isPlaceholderImage(value: string | null) {
  return !value || value.includes("/assets/products/placeholder-");
}

function enrichWithFallback(product: Product): Product {
  const fallback = fallbackBySlug.get(product.slug) ?? fallbackByName.get(normalizeProductName(product.name));

  if (!fallback) {
    return product;
  }

  return {
    ...product,
    image_url: isPlaceholderImage(product.image_url) ? fallback.image_url : product.image_url
  };
}

function normalizeProduct(row: Record<string, unknown>): Product {
  return enrichWithFallback({
    id: String(row.id),
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    category: String(row.category ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    price: Number(row.price ?? 0),
    image_url:
      typeof row.image_url === "string" && row.image_url.length > 0
        ? resolvePublicMediaUrl(row.image_url)
        : null,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order ?? 100),
    weight: typeof row.weight === "string" ? row.weight : null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : null,
    calories: row.calories === null || row.calories === undefined ? null : Number(row.calories),
    protein: row.protein === null || row.protein === undefined ? null : Number(row.protein),
    fat: row.fat === null || row.fat === undefined ? null : Number(row.fat),
    carbs: row.carbs === null || row.carbs === undefined ? null : Number(row.carbs),
    allergens: Array.isArray(row.allergens) ? row.allergens.map(String) : null
  });
}

function normalizeProductImage(row: Record<string, unknown>): ProductImage {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    image_url: resolvePublicMediaUrl(String(row.image_url ?? "")) ?? "",
    alt: typeof row.alt === "string" && row.alt.length > 0 ? row.alt : null,
    sort_order: Number(row.sort_order ?? 100),
    is_primary: Boolean(row.is_primary)
  };
}

function getPreferredProductImage(product: Product, images: ProductImage[]) {
  const preferred = images.find((image) => image.is_primary) ?? images[0];
  return preferred?.image_url || product.image_url;
}

async function attachProductImages(products: Product[]): Promise<Product[]> {
  const database = createDatabaseServerClient();

  if (!database || products.length === 0) {
    return products;
  }

  const ids = products.map((product) => product.id);
  const { data, error } = await database
    .from("product_images")
    .select("id, product_id, created_at, image_url, alt, sort_order, is_primary")
    .in("product_id", ids)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data?.length) {
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("Product images fallback is used:", error.message);
    }
    return products;
  }

  const imagesByProduct = new Map<string, ProductImage[]>();

  data.forEach((row) => {
    const image = normalizeProductImage(row);
    const current = imagesByProduct.get(image.product_id) ?? [];
    current.push(image);
    imagesByProduct.set(image.product_id, current);
  });

  return products.map((product) => {
    const images = imagesByProduct.get(product.id) ?? [];

    return {
      ...product,
      images,
      image_url: getPreferredProductImage(product, images)
    };
  });
}

async function attachProductModifiers(products: Product[]): Promise<Product[]> {
  const database = createDatabaseServerClient();

  if (!database || products.length === 0) {
    return products;
  }

  const productIds = products.map((product) => product.id);
  const { data: lines, error } = await database
    .from("product_ingredients")
    .select("product_id, ingredient_id, quantity, unit, sort_order, is_removable, is_extra_available, extra_quantity, extra_price, max_extra_quantity")
    .in("product_id", productIds)
    .or("is_removable.eq.true,is_extra_available.eq.true")
    .order("sort_order", { ascending: true });

  if (error || !lines?.length) {
    return products;
  }

  const ingredientIds = Array.from(new Set(lines.map((line) => String(line.ingredient_id))));
  const { data: ingredientRows, error: ingredientError } = await database
    .from("ingredients")
    .select("id, name")
    .in("id", ingredientIds);

  if (ingredientError || !ingredientRows) {
    return products;
  }

  const names = new Map(ingredientRows.map((ingredient) => [String(ingredient.id), String(ingredient.name)]));
  const byProduct = new Map<string, ProductModifierOption[]>();

  for (const line of lines) {
    const productId = String(line.product_id);
    const ingredientId = String(line.ingredient_id);
    const name = names.get(ingredientId);

    if (!name) {
      continue;
    }

    const option: ProductModifierOption = {
      ingredient_id: ingredientId,
      name,
      unit: line.unit === "ml" || line.unit === "pcs" ? line.unit : "g",
      base_quantity: Number(line.quantity ?? 0),
      is_removable: Boolean(line.is_removable),
      is_extra_available: Boolean(line.is_extra_available),
      extra_quantity: Number(line.extra_quantity ?? 0),
      extra_price: Number(line.extra_price ?? 0),
      max_extra_quantity: Math.max(1, Number(line.max_extra_quantity ?? 1)),
      sort_order: Number(line.sort_order ?? 100)
    };

    byProduct.set(productId, [...(byProduct.get(productId) ?? []), option]);
  }

  return products.map((product) => ({
    ...product,
    modifier_options: byProduct.get(product.id) ?? []
  }));
}

async function attachProductModifierGroups(products: Product[]): Promise<Product[]> {
  const database = createDatabaseServerClient();

  if (!database || products.length === 0) {
    return products;
  }

  const productIds = products.map((product) => product.id);
  const { data: groupRows, error: groupError } = await database
    .from("product_modifier_groups")
    .select("id, product_id, name, selection_type, min_selections, max_selections, sort_order")
    .in("product_id", productIds)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (groupError || !groupRows?.length) {
    return products.map((product) => ({ ...product, modifier_groups: [] }));
  }

  const groupIds = groupRows.map((group) => String(group.id));
  const { data: optionRows, error: optionError } = await database
    .from("product_modifier_options")
    .select("id, group_id, label, modifier_type, ingredient_id, replacement_ingredient_id, quantity_delta, unit, price_delta, kitchen_note, is_default, sort_order")
    .in("group_id", groupIds)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (optionError) {
    return products.map((product) => ({ ...product, modifier_groups: [] }));
  }

  const optionsByGroup = new Map<string, ProductModifierGroupOption[]>();
  for (const row of optionRows ?? []) {
    const groupId = String(row.group_id);
    const option: ProductModifierGroupOption = {
      id: String(row.id),
      label: String(row.label ?? ""),
      modifier_type:
        row.modifier_type === "remove" || row.modifier_type === "replace"
          ? row.modifier_type
          : "add",
      ingredient_id: row.ingredient_id ? String(row.ingredient_id) : null,
      replacement_ingredient_id: row.replacement_ingredient_id
        ? String(row.replacement_ingredient_id)
        : null,
      quantity_delta: Number(row.quantity_delta ?? 0),
      unit: row.unit === "ml" || row.unit === "pcs" ? row.unit : "g",
      price_delta: Number(row.price_delta ?? 0),
      kitchen_note: typeof row.kitchen_note === "string" ? row.kitchen_note : null,
      is_default: Boolean(row.is_default),
      sort_order: Number(row.sort_order ?? 100)
    };
    optionsByGroup.set(groupId, [...(optionsByGroup.get(groupId) ?? []), option]);
  }

  const groupsByProduct = new Map<string, ProductModifierGroup[]>();
  for (const row of groupRows) {
    const productId = String(row.product_id);
    const group: ProductModifierGroup = {
      id: String(row.id),
      name: String(row.name ?? ""),
      selection_type: row.selection_type === "single" ? "single" : "multi",
      min_selections: Number(row.min_selections ?? 0),
      max_selections: Number(row.max_selections ?? 1),
      sort_order: Number(row.sort_order ?? 100),
      options: optionsByGroup.get(String(row.id)) ?? []
    };
    groupsByProduct.set(productId, [...(groupsByProduct.get(productId) ?? []), group]);
  }

  return products.map((product) => {
    const detailed = { ...product, modifier_groups: groupsByProduct.get(product.id) ?? [] };
    const portionIngredients = new Set(getPortionGroup(detailed)?.options.map(option => option.ingredient_id) ?? []);
    return { ...detailed, modifier_options: detailed.modifier_options?.filter(option => !portionIngredients.has(option.ingredient_id)) };
  });
}

async function attachProductDetails(products: Product[]) {
  const database = createDatabaseServerClient();
  const ambiguous = products.filter(product => !normalizeServing(product.weight));
  if (database && ambiguous.length) {
    const { data } = await database.from("product_ingredients").select("product_id, quantity, unit")
      .in("product_id", ambiguous.map(product => product.id));
    // A one-ingredient snack has a known base portion. Never infer a finished dish's weight from mixed units.
    products = products.map(product => {
      if (normalizeServing(product.weight)) return product;
      const lines = (data ?? []).filter(line => String(line.product_id) === product.id);
      if (lines.length !== 1 || Number(lines[0].quantity) <= 0) return product;
      const unit = lines[0].unit;
      return ["g", "ml", "pcs"].includes(String(unit))
        ? { ...product, weight: formatServing(Number(lines[0].quantity), unit as "g" | "ml" | "pcs") } : product;
    });
  }
  return attachProductModifierGroups(await attachProductModifiers(await attachProductImages(products)));
}

export async function getActiveProducts(limit = 4): Promise<Product[]> {
  const database = createDatabaseServerClient();

  if (!database) {
    return fallbackActiveProducts.slice(0, limit);
  }

  const { data, error } = await database
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(Math.max(limit + 20, 100));

  if (error) {
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("Products could not be loaded:", error.message);
    }
    return [];
  }

  if (!data?.length) {
    return [];
  }

  const publicProducts = data
    .map((row) => normalizeProduct(row))
    .filter(isPublicMenuProduct)
    .slice(0, limit);
  return attachProductDetails(publicProducts);
}

export async function getActiveProductBySlug(slug: string): Promise<Product | null> {
  const database = createDatabaseServerClient();

  if (!database) {
    return fallbackActiveBySlug.get(slug) ?? null;
  }

  const { data, error } = await database
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  let resolvedData = data;
  let resolvedError = error;
  if (!resolvedData && !resolvedError) {
    const aliases = getProductAliases(slug).filter((candidate) => candidate !== slug);
    if (aliases.length) {
      const fallback = await database
        .from("products")
        .select(PRODUCT_SELECT)
        .in("slug", aliases)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      resolvedData = fallback.data;
      resolvedError = fallback.error;
    }
  }

  if (resolvedError || !resolvedData) {
    if (resolvedError && process.env.NODE_ENV !== "production") {
      console.warn("Product detail could not be loaded:", resolvedError.message);
    }
    return null;
  }

  const normalized = normalizeProduct(resolvedData);
  if (!isPublicMenuProduct(normalized)) return null;
  const [product] = await attachProductDetails([normalized]);
  return product ?? null;
}

export async function getPublicProductComposition(productId: string): Promise<ProductCompositionItem[]> {
  const database = createDatabaseServerClient();

  if (!database) {
    return [];
  }

  const { data: lines, error } = await database
    .from("product_ingredients")
    .select("ingredient_id, quantity, unit, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (error || !lines?.length) {
    return [];
  }

  const ingredientIds = Array.from(new Set(lines.map((line) => String(line.ingredient_id))));
  const { data: ingredients, error: ingredientsError } = await database
    .from("ingredients")
    .select("id, name, unit, nutrition_basis_quantity, calories_kcal, proteins_g, fats_g, carbohydrates_g")
    .in("id", ingredientIds);

  if (ingredientsError || !ingredients) {
    return [];
  }

  const ingredientsById = new Map(ingredients.map((ingredient) => [String(ingredient.id), ingredient]));

  return lines.flatMap((line) => {
    const ingredientId = String(line.ingredient_id);
    const ingredient = ingredientsById.get(ingredientId);
    return ingredient
      ? [{
          ingredient_id: ingredientId,
          name: String(ingredient.name),
          sort_order: Number(line.sort_order ?? 100),
          quantity: Number(line.quantity ?? 0),
          unit: line.unit === "ml" || line.unit === "pcs" ? line.unit : "g",
          nutrition_basis_quantity: ingredient.unit === line.unit ? Number(ingredient.nutrition_basis_quantity ?? (line.unit === "pcs" ? 1 : 100)) : 0,
          calories_kcal: ingredient.calories_kcal === null || ingredient.calories_kcal === undefined ? null : Number(ingredient.calories_kcal),
          proteins_g: ingredient.proteins_g === null || ingredient.proteins_g === undefined ? null : Number(ingredient.proteins_g),
          fats_g: ingredient.fats_g === null || ingredient.fats_g === undefined ? null : Number(ingredient.fats_g),
          carbohydrates_g: ingredient.carbohydrates_g === null || ingredient.carbohydrates_g === undefined ? null : Number(ingredient.carbohydrates_g)
        }]
      : [{ ingredient_id: ingredientId, name: "Неизвестный ингредиент", sort_order: Number(line.sort_order ?? 100),
          quantity: Number(line.quantity ?? 0), unit: line.unit === "ml" || line.unit === "pcs" ? line.unit : "g",
          nutrition_basis_quantity: 0, calories_kcal: null, proteins_g: null, fats_g: null, carbohydrates_g: null }];
  });
}

export async function getPublicModifierNutrition(product: Product): Promise<ProductCompositionItem[]> {
  const ids = Array.from(new Set((product.modifier_groups ?? []).flatMap(group => group.options.flatMap(option =>
    [option.ingredient_id, option.replacement_ingredient_id].filter((id): id is string => Boolean(id))))));
  const database = createDatabaseServerClient();
  if (!database || !ids.length) return [];
  const { data, error } = await database.from("ingredients")
    .select("id, name, unit, nutrition_basis_quantity, calories_kcal, proteins_g, fats_g, carbohydrates_g").in("id", ids);
  if (error) return [];
  return (data ?? []).map(row => ({ ingredient_id: String(row.id), name: String(row.name), quantity: 0, sort_order: 0,
    unit: row.unit === "ml" || row.unit === "pcs" ? row.unit : "g", nutrition_basis_quantity: Number(row.nutrition_basis_quantity),
    calories_kcal: row.calories_kcal == null ? null : Number(row.calories_kcal), proteins_g: row.proteins_g == null ? null : Number(row.proteins_g),
    fats_g: row.fats_g == null ? null : Number(row.fats_g), carbohydrates_g: row.carbohydrates_g == null ? null : Number(row.carbohydrates_g) }));
}

export async function getAdminProducts() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      products: [] as Product[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await database
    .from("products")
    .select(PRODUCT_SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const products = await attachProductDetails((data ?? []).map((row) => normalizeProduct(row)));

  return {
    products,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "products")
  };
}

export async function getAdminProductById(id: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      product: null as Product | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await database
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  const products = data ? await attachProductDetails([normalizeProduct(data)]) : [];

  return {
    product: products[0] ?? null,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "products")
  };
}
