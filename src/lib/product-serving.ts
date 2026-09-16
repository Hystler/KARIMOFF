import type { Product, ProductModifierGroup } from "./product-types";

export const PORTION_GROUP_NAME = "Размер порции";
export function getPortionGroup(product: Pick<Product, "modifier_groups">): ProductModifierGroup | undefined {
  return product.modifier_groups?.find(group => group.name === PORTION_GROUP_NAME && group.selection_type === "single" && group.options.length > 0);
}

export function getReplacementControlledIngredientIds(product: Pick<Product, "modifier_groups">) {
  return new Set(
    (product.modifier_groups ?? [])
      .flatMap((group) => group.options)
      .filter((option) => option.modifier_type === "replace" && option.ingredient_id)
      .map((option) => option.ingredient_id as string)
  );
}

export function formatServing(quantity: number, unit: "g" | "ml" | "pcs") {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(quantity)} ${unit === "pcs" ? "шт." : unit === "g" ? "г" : "мл"}`;
}

export function normalizeServing(value?: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(шт\.?|ед\.?|единиц[аы]?|г\.?|гр\.?|грамм(?:а|ов)?|мл\.?)$/i);
  if (!match) return null;
  const quantity = Number(match[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return formatServing(quantity, /^(шт|ед)/i.test(match[2]) ? "pcs" : /^мл/i.test(match[2]) ? "ml" : "g");
}

const PREPARED_DISH_CATEGORY = /(бургер|шаур|хот.?дог|бокс)/i;

export function getServingLabel(
  product: Pick<Product, "weight" | "modifier_groups"> & Partial<Pick<Product, "category">>,
  selectedIds?: string[]
): string | null {
  const group = getPortionGroup(product);
  if (group) {
    const selected = group.options.find(option => selectedIds?.includes(option.id));
    if (selected) return normalizeServing(selected.label) ?? selected.label;
    return [...group.options].sort((a, b) => a.quantity_delta - b.quantity_delta)
      .map(option => normalizeServing(option.label) ?? option.label).join(" или ");
  }
  const serving = normalizeServing(product.weight);
  if (!serving) return null;

  // For a prepared dish "1 pc" is an internal stock unit, not useful guest information.
  if (serving.endsWith(" шт.") && PREPARED_DISH_CATEGORY.test(product.category ?? "")) {
    return null;
  }

  return serving;
}
