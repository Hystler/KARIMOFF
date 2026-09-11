import type { Ingredient } from "./ingredients";
import { calculateRecipeNutrition } from "./product-nutrition";
import { ingredientNutritionReference } from "../data/ingredient-nutrition-reference";

export type NutritionDisplayIngredient = Pick<Ingredient,
  "id" | "name" | "unit" | "nutrition_basis_quantity" | "calories_kcal" | "proteins_g" | "fats_g" | "carbohydrates_g"
>;

export function getIngredientNutritionDisplay(
  ingredient: NutritionDisplayIngredient | null,
  quantity = 1,
  unit: string = ingredient?.unit ?? "g"
) {
  const calculate = (amount: number) => calculateRecipeNutrition(ingredient ? [{
    ...ingredient,
    ingredient_id: ingredient.id,
    sort_order: 0,
    quantity: amount,
    nutrition_basis_quantity: ingredient.unit === unit ? ingredient.nutrition_basis_quantity : 0
  }] : []);
  const perUnit = calculate(1);
  const perPortion = calculate(quantity);
  // Mass metadata may complement entered nutrition, but must never replace its partially filled values.
  const massReference = ingredient?.unit === unit && unit === "pcs"
    ? ingredientNutritionReference.find(reference => reference.name === ingredient.name && reference.unit === unit)
    : undefined;
  const pieceWeight = massReference?.unit_weight_g;
  const unitWeightG = unit === "g" ? 1 : pieceWeight !== undefined && Number.isFinite(pieceWeight) && pieceWeight > 0 ? pieceWeight : null;
  const massEstimated = unitWeightG !== null && massReference?.estimated === true;
  const normalized = unitWeightG === null ? null : calculate(100 / unitWeightG);
  const per100g = normalized ? { ...normalized, estimated: normalized.estimated || massEstimated } : null;
  const hasPartialValues = ingredient && [ingredient.calories_kcal, ingredient.proteins_g, ingredient.fats_g, ingredient.carbohydrates_g]
    .some(value => value !== null);
  const issue = !ingredient ? "Нет данных ингредиента"
    : ingredient.unit !== unit ? "Единицы не совпадают"
    : !perUnit.complete ? hasPartialValues ? "КБЖУ неполные или некорректные" : "КБЖУ не заполнены"
    : null;

  return {
    perUnit,
    perPortion,
    per100g,
    issue,
    massIssue: unitWeightG !== null ? null : unit === "pcs" ? "Нет массы 1 шт." : unit === "ml" ? "Нет плотности, г/мл" : "Неизвестная единица",
    unitWeightG,
    massEstimated,
    source: perUnit.sources[0] ?? null
  };
}

export function formatNutritionUnit(unit: string) {
  return unit === "pcs" ? "шт." : unit === "ml" ? "мл" : unit === "g" ? "г" : unit;
}

export function formatNutritionValue(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "Нет данных";
  if (value > 0 && value < 0.001) return "<0,001";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}
