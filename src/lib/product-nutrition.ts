import type { Product, ProductCompositionItem } from "./product-types";

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
  const missingIngredients = Array.from(new Set(lines
    .filter((line) => (
      line.nutrition_basis_quantity <= 0
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
    items: nutritionItems(total)
  };
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
