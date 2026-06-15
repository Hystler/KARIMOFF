import "server-only";

import { demoProducts } from "@/data/products";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Product } from "./product-types";

export const fallbackProducts: Product[] = demoProducts;

function normalizeProduct(row: Record<string, unknown>): Product {
  return {
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
  };
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

  return data.map((row) => normalizeProduct(row));
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

  return {
    products: (data ?? []).map((row) => normalizeProduct(row)),
    notConfigured: false,
    error: error?.message ?? null
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

  return {
    product: data ? normalizeProduct(data) : null,
    notConfigured: false,
    error: error?.message ?? null
  };
}
