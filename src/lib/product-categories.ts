export type NormalizedProductCategory = "burgers" | "shaurma" | "snacks" | "drinks" | "sauces" | "other";

export const menuCategoryFilters: Array<{ label: string; value: "all" | NormalizedProductCategory }> = [
  { label: "Всё меню", value: "all" },
  { label: "Бургеры", value: "burgers" },
  { label: "Шаурма", value: "shaurma" },
  { label: "Снэки", value: "snacks" }
];

export const adminProductCategoryOptions = ["Бургеры", "Шаурма", "Снэки", "Напитки", "Соусы", "Другое"];

export function isPublicMenuCategory(category: string | null | undefined) {
  return normalizeProductCategory(category) !== "drinks";
}

export function normalizeProductCategory(category: string | null | undefined): NormalizedProductCategory {
  const value = String(category ?? "")
    .trim()
    .toLowerCase();

  if (!value) {
    return "other";
  }

  if (/(бургер|burger|burgers)/i.test(value)) {
    return "burgers";
  }

  if (/(шаур|shaur)/i.test(value)) {
    return "shaurma";
  }

  if (/(напит|drink|drinks|компот|лимонад|cola|кола|сок|вода)/i.test(value)) {
    return "drinks";
  }

  if (/(соус|sauce|sauces)/i.test(value)) {
    return "sauces";
  }

  if (/(снэк|snack|snacks|закуск|горяч|бокс|box|boxes|карто|фри|наггет|хот.?дог|hot.?dog|dog)/i.test(value)) {
    return "snacks";
  }

  return "other";
}
