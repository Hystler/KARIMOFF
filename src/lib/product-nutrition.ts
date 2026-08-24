import type { Product } from "./product-types";

export type ProductNutritionItem = {
  key: "calories" | "protein" | "fat" | "carbs";
  label: string;
  unit: "ккал" | "г";
  value: number | null;
};

export function getProductNutrition(
  product: Pick<Product, "calories" | "protein" | "fat" | "carbs">
) {
  const items: ProductNutritionItem[] = [
    { key: "calories", label: "Калорийность", unit: "ккал", value: product.calories ?? null },
    { key: "protein", label: "Белки", unit: "г", value: product.protein ?? null },
    { key: "fat", label: "Жиры", unit: "г", value: product.fat ?? null },
    { key: "carbs", label: "Углеводы", unit: "г", value: product.carbs ?? null }
  ];

  return {
    available: items.some((item) => item.value !== null),
    items
  };
}
