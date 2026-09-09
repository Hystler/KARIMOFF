import type { Product, ProductCompositionItem } from "./product-types";
import { getIngredientNutritionReference } from "./ingredient-nutrition";

export type ProductNutritionItem = {
  key: "calories" | "protein" | "fat" | "carbs";
  label: string;
  unit: "ккал" | "г";
  value: number | null;
};

function nutritionItems(values: {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}): ProductNutritionItem[] {
  return [
    { key: "calories", label: "Калорийность", unit: "ккал", value: values.calories },
    { key: "protein", label: "Белки", unit: "г", value: values.protein },
    { key: "fat", label: "Жиры", unit: "г", value: values.fat },
    { key: "carbs", label: "Углеводы", unit: "г", value: values.carbs }
  ];
}

export function calculateRecipeNutrition(lines: ProductCompositionItem[]) {
  const sources = new Map<string, { ingredient: string; name: string; url: string }>();
  lines = lines.map(line => {
    const reference = line.nutrition_basis_quantity > 0 ? getIngredientNutritionReference(line) : undefined;
    if (reference) sources.set(line.ingredient_id, { ingredient: line.name, name: reference.sourceName, url: reference.sourceUrl });
    return reference ? { ...line, nutrition_basis_quantity: 100, calories_kcal: reference.calories_kcal,
      proteins_g: reference.proteins_g, fats_g: reference.fats_g, carbohydrates_g: reference.carbohydrates_g } : line;
  });
  const missingIngredients = Array.from(new Set(lines
    .filter((line) => (
      !Number.isFinite(line.nutrition_basis_quantity) || line.nutrition_basis_quantity <= 0
      || !Number.isFinite(line.quantity) || line.quantity <= 0
      || [line.calories_kcal, line.proteins_g, line.fats_g, line.carbohydrates_g].some(value => value !== null && (!Number.isFinite(value) || value < 0))
      || line.calories_kcal === null
      || line.proteins_g === null
      || line.fats_g === null
      || line.carbohydrates_g === null
    ))
    .map((line) => line.name)));
  const complete = lines.length > 0 && missingIngredients.length === 0;

  if (!complete) {
    return {
      available: false,
      complete: false,
      missingIngredients,
      estimated: sources.size > 0,
      sources: [...sources.values()],
      items: nutritionItems({ calories: null, protein: null, fat: null, carbs: null })
    };
  }

  const total = lines.reduce((sum, line) => {
    const multiplier = line.quantity / line.nutrition_basis_quantity;
    return {
      calories: sum.calories + (line.calories_kcal ?? 0) * multiplier,
      protein: sum.protein + (line.proteins_g ?? 0) * multiplier,
      fat: sum.fat + (line.fats_g ?? 0) * multiplier,
      carbs: sum.carbs + (line.carbohydrates_g ?? 0) * multiplier
    };
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });

  return {
    available: true,
    complete: true,
    missingIngredients: [] as string[],
    estimated: sources.size > 0,
    sources: [...sources.values()],
    items: nutritionItems(total)
  };
}

export function getCustomizedNutrition(product: Product, composition: ProductCompositionItem[], references: ProductCompositionItem[], customization: {
  removed: Array<{ ingredient_id: string }>; extras: Array<{ ingredient_id: string; quantity: number }>; modifierOptionIds: string[];
}) {
  const source = new Map([...composition, ...references].map(line => [line.ingredient_id, line]));
  let lines = composition.filter(line => !customization.removed.some(item => item.ingredient_id === line.ingredient_id));
  const options = (product.modifier_groups ?? []).flatMap(group => group.options).filter(option => customization.modifierOptionIds.includes(option.id));
  // Only the base recipe is removed/replaced; separately selected extras still count.
  lines = lines.filter(line => !options.some(option => option.ingredient_id === line.ingredient_id && option.modifier_type !== "add"));
  const append = (id: string, quantity: number, unit: "g" | "ml" | "pcs") => {
    const reference = source.get(id);
    lines.push(reference && reference.unit === unit ? { ...reference, quantity } : {
      ingredient_id: id, name: reference?.name ?? "Добавка", quantity, unit, sort_order: 0,
      nutrition_basis_quantity: 0, calories_kcal: null, proteins_g: null, fats_g: null, carbohydrates_g: null
    });
  };
  for (const extra of customization.extras) {
    const option = product.modifier_options?.find(option => option.ingredient_id === extra.ingredient_id);
    if (option && extra.quantity > 0) append(extra.ingredient_id, option.extra_quantity * extra.quantity, option.unit);
  }
  for (const option of options) {
    if (option.modifier_type === "replace" && option.replacement_ingredient_id) append(option.replacement_ingredient_id, option.quantity_delta, option.unit);
    if (option.modifier_type === "add" && option.ingredient_id) append(option.ingredient_id, option.quantity_delta, option.unit);
  }
  return calculateRecipeNutrition(lines);
}

export function getProductNutrition(
  product: Pick<Product, "calories" | "protein" | "fat" | "carbs">,
  composition?: ProductCompositionItem[]
) {
  if (composition !== undefined) {
    return calculateRecipeNutrition(composition);
  }

  const items = nutritionItems({
    calories: product.calories ?? null,
    protein: product.protein ?? null,
    fat: product.fat ?? null,
    carbs: product.carbs ?? null
  });

  return {
    available: items.some((item) => item.value !== null),
    complete: items.every((item) => item.value !== null),
    missingIngredients: [] as string[],
    items
  };
}
