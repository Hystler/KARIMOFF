import "server-only";

import { demoProducts } from "@/data/products";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Product, ProductImage } from "./product-types";

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
    image_url: typeof row.image_url === "string" && row.image_url.length > 0 ? row.image_url : null,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order ?? 100),
    weight: typeof row.weight === "string" ? row.weight : null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : null
  });
}

function normalizeProductImage(row: Record<string, unknown>): ProductImage {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    image_url: String(row.image_url ?? ""),
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
  const supabase = createSupabaseServerClient();

  if (!supabase || products.length === 0) {
    return products;
  }

  const ids = products.map((product) => product.id);
  const { data, error } = await supabase
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

export async function getActiveProducts(limit = 4): Promise<Product[]> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return fallbackProducts.slice(0, limit);
  }

  const { data, error } = await supabase
    .from("products")
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags")
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

  return attachProductImages(data.map((row) => normalizeProduct(row)));
}

export async function getAdminProducts() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      products: [] as Product[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const products = await attachProductImages((data ?? []).map((row) => normalizeProduct(row)));

  return {
    products,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "products", "supabase/products.sql")
  };
}

export async function getAdminProductById(id: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      product: null as Product | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select("id, created_at, updated_at, name, slug, category, description, price, image_url, is_active, sort_order, weight, tags")
    .eq("id", id)
    .maybeSingle();

  const products = data ? await attachProductImages([normalizeProduct(data)]) : [];

  return {
    product: products[0] ?? null,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "products", "supabase/products.sql")
  };
}
