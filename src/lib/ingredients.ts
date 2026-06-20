import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Product } from "./product-types";

export type Ingredient = {
  id: string;
  created_at: string;
  updated_at: string | null;
  name: string;
  category: string | null;
  unit: "g" | "ml" | "pcs";
  cost_per_unit: number;
  package_size: number | null;
  package_price: number | null;
  is_active: boolean;
  sort_order: number;
};

export type ProductIngredientLine = {
  id: string;
  product_id: string;
  ingredient_id: string;
  ingredient_name: string;
  ingredient_category: string | null;
  ingredient_unit: "g" | "ml" | "pcs";
  quantity: number;
  unit: "g" | "ml" | "pcs";
  cost_per_unit: number;
  line_cost: number;
  sort_order: number;
};

export type ProductFoodCost = {
  product: Product;
  lines: ProductIngredientLine[];
  food_cost: number | null;
  food_cost_percent: number | null;
  gross_profit: number | null;
  gross_margin_percent: number | null;
};

function normalizeUnit(value: unknown): "g" | "ml" | "pcs" {
  return value === "ml" || value === "pcs" ? value : "g";
}

function normalizeIngredient(row: Record<string, unknown>): Ingredient {
  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    name: String(row.name ?? ""),
    category: typeof row.category === "string" && row.category.length > 0 ? row.category : null,
    unit: normalizeUnit(row.unit),
    cost_per_unit: Number(row.cost_per_unit ?? 0),
    package_size: row.package_size === null || row.package_size === undefined ? null : Number(row.package_size),
    package_price: row.package_price === null || row.package_price === undefined ? null : Number(row.package_price),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 100)
  };
}

function calculateMetrics(product: Product, lines: ProductIngredientLine[]): ProductFoodCost {
  if (!lines.length) {
    return {
      product,
      lines,
      food_cost: null,
      food_cost_percent: null,
      gross_profit: null,
      gross_margin_percent: null
    };
  }

  const foodCost = lines.reduce((sum, line) => sum + line.line_cost, 0);
  const foodCostPercent = product.price > 0 ? (foodCost / product.price) * 100 : null;
  const grossProfit = product.price - foodCost;
  const grossMarginPercent = product.price > 0 ? (grossProfit / product.price) * 100 : null;

  return {
    product,
    lines,
    food_cost: foodCost,
    food_cost_percent: foodCostPercent,
    gross_profit: grossProfit,
    gross_margin_percent: grossMarginPercent
  };
}

export async function getAdminIngredients() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      ingredients: [] as Ingredient[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("ingredients")
    .select("id, created_at, updated_at, name, category, unit, cost_per_unit, package_size, package_price, is_active, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return {
    ingredients: (data ?? []).map((row) => normalizeIngredient(row)),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "ingredients", "supabase/ingredients.sql")
  };
}

export async function getAdminIngredientById(id: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      ingredient: null as Ingredient | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("ingredients")
    .select("id, created_at, updated_at, name, category, unit, cost_per_unit, package_size, package_price, is_active, sort_order")
    .eq("id", id)
    .maybeSingle();

  return {
    ingredient: data ? normalizeIngredient(data) : null,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "ingredients", "supabase/ingredients.sql")
  };
}

export async function getProductFoodCost(product: Product) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      foodCost: calculateMetrics(product, []),
      ingredients: [] as Ingredient[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const [{ ingredients, error: ingredientsError }, { data: lineRows, error: linesError }] = await Promise.all([
    getAdminIngredients(),
    supabase
      .from("product_ingredients")
      .select("id, product_id, ingredient_id, quantity, unit, sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true })
  ]);

  if (ingredientsError) {
    return {
      foodCost: calculateMetrics(product, []),
      ingredients,
      notConfigured: false,
      error: ingredientsError
    };
  }

  if (linesError) {
    return {
      foodCost: calculateMetrics(product, []),
      ingredients,
      notConfigured: false,
      error: formatMissingTableError(linesError.message, "product_ingredients", "supabase/ingredients.sql")
    };
  }

  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const lines = (lineRows ?? [])
    .map((line) => {
      const ingredient = ingredientsById.get(String(line.ingredient_id));

      if (!ingredient) {
        return null;
      }

      const quantity = Number(line.quantity ?? 0);
      const costPerUnit = ingredient.cost_per_unit;

      return {
        id: String(line.id),
        product_id: String(line.product_id),
        ingredient_id: String(line.ingredient_id),
        ingredient_name: ingredient.name,
        ingredient_category: ingredient.category,
        ingredient_unit: ingredient.unit,
        quantity,
        unit: normalizeUnit(line.unit),
        cost_per_unit: costPerUnit,
        line_cost: quantity * costPerUnit,
        sort_order: Number(line.sort_order ?? 100)
      } satisfies ProductIngredientLine;
    })
    .filter((line): line is ProductIngredientLine => Boolean(line));

  return {
    foodCost: calculateMetrics(product, lines),
    ingredients,
    notConfigured: false,
    error: null as string | null
  };
}

export async function getProductsFoodCosts(products: Product[]) {
  const supabase = createSupabaseServerClient();

  if (!supabase || !products.length) {
    return {
      items: products.map((product) => calculateMetrics(product, [])),
      notConfigured: !supabase,
      error: null as string | null
    };
  }

  const productIds = products.map((product) => product.id);
  const { ingredients, error: ingredientsError } = await getAdminIngredients();

  if (ingredientsError) {
    return {
      items: products.map((product) => calculateMetrics(product, [])),
      notConfigured: false,
      error: ingredientsError
    };
  }

  const { data: lineRows, error: linesError } = await supabase
    .from("product_ingredients")
    .select("id, product_id, ingredient_id, quantity, unit, sort_order")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });

  if (linesError) {
    return {
      items: products.map((product) => calculateMetrics(product, [])),
      notConfigured: false,
      error: formatMissingTableError(linesError.message, "product_ingredients", "supabase/ingredients.sql")
    };
  }

  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const linesByProduct = new Map<string, ProductIngredientLine[]>();

  for (const line of lineRows ?? []) {
    const ingredient = ingredientsById.get(String(line.ingredient_id));

    if (!ingredient) {
      continue;
    }

    const productId = String(line.product_id);
    const quantity = Number(line.quantity ?? 0);
    const row: ProductIngredientLine = {
      id: String(line.id),
      product_id: productId,
      ingredient_id: String(line.ingredient_id),
      ingredient_name: ingredient.name,
      ingredient_category: ingredient.category,
      ingredient_unit: ingredient.unit,
      quantity,
      unit: normalizeUnit(line.unit),
      cost_per_unit: ingredient.cost_per_unit,
      line_cost: quantity * ingredient.cost_per_unit,
      sort_order: Number(line.sort_order ?? 100)
    };

    linesByProduct.set(productId, [...(linesByProduct.get(productId) ?? []), row]);
  }

  return {
    items: products.map((product) => calculateMetrics(product, linesByProduct.get(product.id) ?? [])),
    notConfigured: false,
    error: null as string | null
  };
}
