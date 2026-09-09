import { ingredientNutritionReference } from "../data/ingredient-nutrition-reference";

export function getIngredientNutritionReference(line: {
  name: string; unit: string; calories_kcal: number | null; proteins_g: number | null;
  fats_g: number | null; carbohydrates_g: number | null;
}) {
  if (line.unit !== "g" || [line.calories_kcal, line.proteins_g, line.fats_g, line.carbohydrates_g].some(value => value !== null)) return undefined;
  // Deliberately exact: raw red onion must never match fried onion or a sauce.
  return ingredientNutritionReference.find(reference => reference.name === line.name);
}
