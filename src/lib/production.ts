import "server-only";

import { createDatabaseServerClient } from "@/lib/database/server";
import { formatMissingTableError } from "@/lib/database/errors";
import { getAdminIngredients, type Ingredient } from "@/lib/ingredients";
import { getInventoryByIngredientIds } from "@/lib/inventory";
import {
  calculateProductionMetrics,
  getBaseProductionUnit,
  productionUnitFamily,
  toBaseProductionQuantity,
  type ProductionUnit
} from "@/lib/production-calculations";

export type ProductionComponent = {
  id: string;
  ingredient_id: string;
  ingredient: Ingredient;
  is_primary: boolean;
  quantity: number;
  sort_order: number;
  unit: ProductionUnit;
};

export type ProductionDirectExpense = {
  amount_per_batch: number;
  category: "labor" | "electricity" | "packaging" | "supplies" | "logistics" | "other";
  id: string;
  name: string;
  sort_order: number;
};

export type ProductionOverhead = {
  amount_per_unit: number;
  category: "payroll" | "rent" | "utilities" | "sanitation" | "maintenance" | "accounting" | "stationery" | "logistics" | "other";
  comment: string | null;
  id: string;
  is_active: boolean;
  monthly_amount: number;
  name: string;
  quantity: number;
  sort_order: number;
};

export type ProductionRecipe = {
  batch_duration_minutes: number;
  category: string | null;
  components: ProductionComponent[];
  created_at: string;
  direct_expenses: ProductionDirectExpense[];
  id: string;
  is_active: boolean;
  name: string;
  notes: string | null;
  output_ingredient: Ingredient;
  output_ingredient_id: string;
  output_quantity: number;
  output_unit: ProductionUnit;
  planned_batches_per_month: number;
  sale_price_per_output_unit: number;
  sort_order: number;
  updated_at: string | null;
};

export type ProductionRecipeView = ProductionRecipe & {
  available_batches: number;
  metrics: ReturnType<typeof calculateProductionMetrics>;
  output_stock: number;
};

export type ProductionRun = {
  batch_count: number;
  cost_per_base_unit: number;
  created_at: string;
  created_by: string;
  direct_cost: number;
  gross_margin_percent: number | null;
  gross_profit: number;
  id: string;
  material_cost: number;
  notes: string | null;
  output_quantity: number;
  output_unit: ProductionUnit;
  overhead_cost: number;
  planned_revenue: number;
  recipe_id: string;
  recipe_name: string;
  run_date: string;
  sale_price_per_output_unit: number;
  total_cost: number;
};

function normalizeUnit(value: unknown): ProductionUnit {
  return value === "kg" || value === "ml" || value === "l" || value === "pcs" ? value : "g";
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function tableError(message: string | null | undefined, table: string) {
  return formatMissingTableError(message, table);
}

export async function getProductionWorkspace() {
  const database = createDatabaseServerClient();
  if (!database) {
    return {
      error: null as string | null,
      ingredients: [] as Ingredient[],
      monthlyOverhead: 0,
      notConfigured: true,
      overheads: [] as ProductionOverhead[],
      recipes: [] as ProductionRecipeView[],
      runs: [] as ProductionRun[],
      totalPlannedMinutes: 0
    };
  }

  const ingredientsResult = await getAdminIngredients();
  if (ingredientsResult.error) {
    return {
      error: ingredientsResult.error,
      ingredients: ingredientsResult.ingredients,
      monthlyOverhead: 0,
      notConfigured: false,
      overheads: [] as ProductionOverhead[],
      recipes: [] as ProductionRecipeView[],
      runs: [] as ProductionRun[],
      totalPlannedMinutes: 0
    };
  }

  const [recipeResult, componentResult, directExpenseResult, overheadResult, runResult] = await Promise.all([
    database
      .from("production_recipes")
      .select("id, created_at, updated_at, name, output_ingredient_id, category, output_quantity, output_unit, batch_duration_minutes, planned_batches_per_month, sale_price_per_output_unit, notes, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    database
      .from("production_recipe_items")
      .select("id, recipe_id, ingredient_id, quantity, unit, is_primary, sort_order")
      .order("sort_order", { ascending: true }),
    database
      .from("production_recipe_expenses")
      .select("id, recipe_id, category, name, amount_per_batch, sort_order")
      .order("sort_order", { ascending: true }),
    database
      .from("production_overheads")
      .select("id, name, category, quantity, amount_per_unit, comment, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    database
      .from("production_runs")
      .select("id, created_at, recipe_id, run_date, batch_count, output_quantity, output_unit, material_cost, direct_cost, overhead_cost, total_cost, cost_per_base_unit, sale_price_per_output_unit, planned_revenue, gross_profit, gross_margin_percent, notes, created_by")
      .order("created_at", { ascending: false })
      .limit(30)
  ]);

  const firstError = [
    [recipeResult.error, "production_recipes"],
    [componentResult.error, "production_recipe_items"],
    [directExpenseResult.error, "production_recipe_expenses"],
    [overheadResult.error, "production_overheads"],
    [runResult.error, "production_runs"]
  ].find(([error]) => Boolean(error)) as [{ message: string } | null, string] | undefined;

  if (firstError?.[0]) {
    return {
      error: tableError(firstError[0].message, firstError[1]),
      ingredients: ingredientsResult.ingredients,
      monthlyOverhead: 0,
      notConfigured: false,
      overheads: [] as ProductionOverhead[],
      recipes: [] as ProductionRecipeView[],
      runs: [] as ProductionRun[],
      totalPlannedMinutes: 0
    };
  }

  const ingredientsById = new Map(ingredientsResult.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const componentsByRecipe = new Map<string, ProductionComponent[]>();
  for (const row of componentResult.data ?? []) {
    const ingredient = ingredientsById.get(String(row.ingredient_id));
    if (!ingredient) continue;
    const recipeId = String(row.recipe_id);
    const component: ProductionComponent = {
      id: String(row.id),
      ingredient_id: ingredient.id,
      ingredient,
      is_primary: Boolean(row.is_primary),
      quantity: Number(row.quantity ?? 0),
      sort_order: Number(row.sort_order ?? 100),
      unit: normalizeUnit(row.unit)
    };
    componentsByRecipe.set(recipeId, [...(componentsByRecipe.get(recipeId) ?? []), component]);
  }

  const expensesByRecipe = new Map<string, ProductionDirectExpense[]>();
  for (const row of directExpenseResult.data ?? []) {
    const recipeId = String(row.recipe_id);
    const expense: ProductionDirectExpense = {
      amount_per_batch: Number(row.amount_per_batch ?? 0),
      category: String(row.category ?? "other") as ProductionDirectExpense["category"],
      id: String(row.id),
      name: String(row.name ?? "Расход"),
      sort_order: Number(row.sort_order ?? 100)
    };
    expensesByRecipe.set(recipeId, [...(expensesByRecipe.get(recipeId) ?? []), expense]);
  }

  const overheads: ProductionOverhead[] = (overheadResult.data ?? []).map((row) => {
    const quantity = Number(row.quantity ?? 0);
    const amountPerUnit = Number(row.amount_per_unit ?? 0);
    return {
      amount_per_unit: amountPerUnit,
      category: String(row.category ?? "other") as ProductionOverhead["category"],
      comment: nullableText(row.comment),
      id: String(row.id),
      is_active: row.is_active !== false,
      monthly_amount: quantity * amountPerUnit,
      name: String(row.name ?? "Расход"),
      quantity,
      sort_order: Number(row.sort_order ?? 100)
    };
  });
  const monthlyOverhead = overheads
    .filter((overhead) => overhead.is_active)
    .reduce((sum, overhead) => sum + overhead.monthly_amount, 0);

  const rawRecipes: ProductionRecipe[] = (recipeResult.data ?? []).flatMap((row) => {
    const outputIngredient = ingredientsById.get(String(row.output_ingredient_id));
    if (!outputIngredient) return [];
    const id = String(row.id);
    return [{
      batch_duration_minutes: Number(row.batch_duration_minutes ?? 60),
      category: nullableText(row.category),
      components: componentsByRecipe.get(id) ?? [],
      created_at: String(row.created_at ?? ""),
      direct_expenses: expensesByRecipe.get(id) ?? [],
      id,
      is_active: row.is_active !== false,
      name: String(row.name ?? "Производственная карта"),
      notes: nullableText(row.notes),
      output_ingredient: outputIngredient,
      output_ingredient_id: outputIngredient.id,
      output_quantity: Number(row.output_quantity ?? 0),
      output_unit: normalizeUnit(row.output_unit),
      planned_batches_per_month: Number(row.planned_batches_per_month ?? 0),
      sale_price_per_output_unit: Number(row.sale_price_per_output_unit ?? 0),
      sort_order: Number(row.sort_order ?? 100),
      updated_at: nullableText(row.updated_at)
    } satisfies ProductionRecipe];
  });

  const totalPlannedMinutes = rawRecipes
    .filter((recipe) => recipe.is_active)
    .reduce((sum, recipe) => sum + recipe.batch_duration_minutes * recipe.planned_batches_per_month, 0);
  const usedIngredientIds = Array.from(new Set([
    ...rawRecipes.flatMap((recipe) => recipe.components.map((component) => component.ingredient_id)),
    ...rawRecipes.map((recipe) => recipe.output_ingredient_id)
  ]));
  const inventoryResult = await getInventoryByIngredientIds(usedIngredientIds);

  const recipes: ProductionRecipeView[] = rawRecipes.map((recipe) => {
    const metrics = calculateProductionMetrics({
      batchDurationMinutes: recipe.batch_duration_minutes,
      components: recipe.components.map((component) => ({
        costPerBaseUnit: component.ingredient.cost_per_unit,
        isPrimary: component.is_primary,
        quantity: component.quantity,
        unit: component.unit
      })),
      directExpenses: recipe.direct_expenses.map((expense) => ({ amountPerBatch: expense.amount_per_batch })),
      monthlyOverhead,
      outputQuantity: recipe.output_quantity,
      outputUnit: recipe.output_unit,
      plannedBatchesPerMonth: recipe.planned_batches_per_month,
      salePricePerOutputUnit: recipe.sale_price_per_output_unit,
      totalPlannedMinutes
    });
    const availableBatches = recipe.components.length
      ? Math.min(...recipe.components.map((component) => {
          const available = inventoryResult.itemsByIngredient.get(component.ingredient_id)?.current_quantity ?? 0;
          const required = toBaseProductionQuantity(component.quantity, component.unit);
          return required > 0 ? Math.floor(available / required) : 0;
        }))
      : 0;

    return {
      ...recipe,
      available_batches: Number.isFinite(availableBatches) ? availableBatches : 0,
      metrics,
      output_stock: inventoryResult.itemsByIngredient.get(recipe.output_ingredient_id)?.current_quantity ?? 0
    };
  });
  const recipeNames = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const runs: ProductionRun[] = (runResult.data ?? []).map((row) => ({
    batch_count: Number(row.batch_count ?? 1),
    cost_per_base_unit: Number(row.cost_per_base_unit ?? 0),
    created_at: String(row.created_at ?? ""),
    created_by: String(row.created_by ?? "admin"),
    direct_cost: Number(row.direct_cost ?? 0),
    gross_margin_percent: row.gross_margin_percent === null ? null : Number(row.gross_margin_percent),
    gross_profit: Number(row.gross_profit ?? 0),
    id: String(row.id),
    material_cost: Number(row.material_cost ?? 0),
    notes: nullableText(row.notes),
    output_quantity: Number(row.output_quantity ?? 0),
    output_unit: normalizeUnit(row.output_unit),
    overhead_cost: Number(row.overhead_cost ?? 0),
    planned_revenue: Number(row.planned_revenue ?? 0),
    recipe_id: String(row.recipe_id),
    recipe_name: recipeNames.get(String(row.recipe_id)) ?? "Удалённая карта",
    run_date: String(row.run_date ?? ""),
    sale_price_per_output_unit: Number(row.sale_price_per_output_unit ?? 0),
    total_cost: Number(row.total_cost ?? 0)
  }));

  return {
    error: inventoryResult.error,
    ingredients: ingredientsResult.ingredients,
    monthlyOverhead,
    notConfigured: false,
    overheads,
    recipes,
    runs,
    totalPlannedMinutes
  };
}

export async function getProductionRecipeById(id: string) {
  const workspace = await getProductionWorkspace();
  return {
    ...workspace,
    recipe: workspace.recipes.find((recipe) => recipe.id === id) ?? null
  };
}

export function getProductionOutputCostLabel(recipe: ProductionRecipeView) {
  const baseUnit = getBaseProductionUnit(recipe.output_unit);
  return baseUnit === "g"
    ? { amount: recipe.metrics.costPer100BaseUnits, label: "за 100 г" }
    : baseUnit === "ml"
      ? { amount: recipe.metrics.costPer100BaseUnits, label: "за 100 мл" }
      : { amount: recipe.metrics.costPerOutputUnit, label: "за 1 шт." };
}

export function isProductionUnitCompatible(ingredientUnit: string, productionUnit: string) {
  return productionUnitFamily(ingredientUnit) === productionUnitFamily(productionUnit);
}
