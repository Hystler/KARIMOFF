import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";

export type AdminOverviewSnapshot = {
  activeProducts: number;
  hiddenProducts: number;
  productsWithoutFoodCost: number;
  productsWithoutNutrition: number;
  activeIngredients: number;
  ingredientsWithoutPrice: number;
  ingredientsWithoutNutrition: number;
  inventoryCards: number;
  lowStockItems: number;
  productionRecipes: number;
  productionRuns30d: number;
  activeLocations: number;
};

const emptySnapshot: AdminOverviewSnapshot = {
  activeProducts: 0,
  hiddenProducts: 0,
  productsWithoutFoodCost: 0,
  productsWithoutNutrition: 0,
  activeIngredients: 0,
  ingredientsWithoutPrice: 0,
  ingredientsWithoutNutrition: 0,
  inventoryCards: 0,
  lowStockItems: 0,
  productionRecipes: 0,
  productionRuns30d: 0,
  activeLocations: 0
};

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAdminOverviewSnapshot() {
  try {
    const sql = getPostgresSql();
    const [row] = await sql`
      select
        (select count(*) from public.products where is_active)::int as active_products,
        (select count(*) from public.products where not is_active)::int as hidden_products,
        (select count(*) from public.products product
          where product.is_active and (
            not exists (select 1 from public.product_ingredients recipe where recipe.product_id=product.id and recipe.quantity>0)
            or exists (
              select 1 from public.product_ingredients recipe
              left join public.ingredients ingredient on ingredient.id=recipe.ingredient_id
              where recipe.product_id=product.id and recipe.quantity>0
                and (ingredient.id is null or coalesce(ingredient.cost_per_unit,0)<=0 or recipe.unit<>ingredient.unit)
            )
          ))::int as products_without_food_cost,
        (select count(*) from public.products product
          where product.is_active and (
            not exists (select 1 from public.product_ingredients recipe where recipe.product_id=product.id and recipe.quantity>0)
            or exists (
              select 1 from public.product_ingredients recipe
              left join public.ingredients ingredient on ingredient.id=recipe.ingredient_id
              where recipe.product_id=product.id and recipe.quantity>0
                and (ingredient.id is null or ingredient.calories_kcal is null or ingredient.proteins_g is null
                  or ingredient.fats_g is null or ingredient.carbohydrates_g is null)
            )
          ))::int as products_without_nutrition,
        (select count(*) from public.ingredients where is_active)::int as active_ingredients,
        (select count(*) from public.ingredients where is_active and coalesce(cost_per_unit,0)<=0)::int as ingredients_without_price,
        (select count(*) from public.ingredients where is_active and (
          calories_kcal is null or proteins_g is null or fats_g is null or carbohydrates_g is null
        ))::int as ingredients_without_nutrition,
        (select count(*) from public.inventory_items where is_active)::int as inventory_cards,
        (select count(*) from public.inventory_items where is_active
          and current_quantity-reserved_quantity<=min_quantity)::int as low_stock_items,
        (select count(*) from public.production_recipes where is_active)::int as production_recipes,
        (select count(*) from public.production_runs where created_at>=now()-interval '30 days')::int as production_runs_30d,
        (select count(*) from public.order_locations where is_active)::int as active_locations
    `;
    if (!row) return { snapshot: emptySnapshot, error: "Нет данных" };
    return {
      snapshot: {
        activeProducts: numeric(row.active_products),
        hiddenProducts: numeric(row.hidden_products),
        productsWithoutFoodCost: numeric(row.products_without_food_cost),
        productsWithoutNutrition: numeric(row.products_without_nutrition),
        activeIngredients: numeric(row.active_ingredients),
        ingredientsWithoutPrice: numeric(row.ingredients_without_price),
        ingredientsWithoutNutrition: numeric(row.ingredients_without_nutrition),
        inventoryCards: numeric(row.inventory_cards),
        lowStockItems: numeric(row.low_stock_items),
        productionRecipes: numeric(row.production_recipes),
        productionRuns30d: numeric(row.production_runs_30d),
        activeLocations: numeric(row.active_locations)
      },
      error: null as string | null
    };
  } catch (error) {
    return {
      snapshot: emptySnapshot,
      error: error instanceof Error ? error.message : "Не удалось загрузить показатели"
    };
  }
}
