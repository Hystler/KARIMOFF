import "server-only";

import { demoProducts } from "@/data/products";
import { resolvePublicMediaUrl } from "@/lib/media-url";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import type { Product, ProductImage, ProductModifierOption } from "./product-types";

export const fallbackProducts: Product[] = demoProducts;

const fallbackBySlug = new Map(fallbackProducts.map((product) => [product.slug, product]));
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
    description: product.description || fallback.description,
    image_url: isPlaceholderImage(product.image_url) ? fallback.image_url : product.image_url,
    weight: product.weight || fallback.weight || null
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

async function attachProductDetails(products: Product[]) {
  return attachProductModifiers(await attachProductImages(products));
}

export async function getActiveProducts(limit = 4): Promise<Product[]> {
  const database = createDatabaseServerClient();

  if (!database) {
    return fallbackProducts.slice(0, limit);
  }

  const { data, error } = await database
    .from("products")
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags, calories, protein, fat, carbs, allergens")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data?.length) {
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("Products fallback is used:", error.message);
    }
    return fallbackProducts.slice(0, limit);
  }

  return attachProductDetails(data.map((row) => normalizeProduct(row)));
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
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags, calories, protein, fat, carbs, allergens")
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
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags, calories, protein, fat, carbs, allergens")
    .eq("id", id)
    .maybeSingle();

  const products = data ? await attachProductDetails([normalizeProduct(data)]) : [];

  return {
    product: products[0] ?? null,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "products")
  };
}
