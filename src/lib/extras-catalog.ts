export const extrasGroupName = "Допы KARIMOFF";

export const extrasCatalog = [
  { key: "fries", name: "Картофель фри", label: "Картофель фри · 50 г", quantity: 50, unit: "g", price: 40 },
  { key: "onion", name: "Лук жареный гранулированный", label: "Жареный лук · 15 г", quantity: 15, unit: "g", price: 40 },
  { key: "cheese-stick", name: "Сырная палочка", label: "Сырная палочка · 1 шт.", quantity: 1, unit: "pcs", price: 40 },
  { key: "bacon", name: "Бекон жареный", label: "Бекон · 20 г", quantity: 1, unit: "pcs", price: 40, note: "Порция 20 г. Временный учёт: 1 закупочная штука на порцию, массу нужно сверить." },
  { key: "jalapeno", name: "Халапеньо", label: "Халапеньо · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "cheddar", name: "Сыр Чеддер, ломтик", label: "Сыр Чеддер · 12 г", quantity: 1, unit: "pcs", price: 40, note: "Порция 12 г. Временный учёт: 1 ломтик на порцию, массу нужно сверить." },
  { key: "bbq", name: "Соус фирменный барбекю", label: "Соус барбекю · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "garlic", name: "Соус чесночный", label: "Соус чесночный · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "caesar", name: "Соус Цезарь", label: "Соус Цезарь · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "tasty", name: "Соус Тейсти", label: "Соус тейсти · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "cheese-sauce", name: "Соус сырный", label: "Соус сырный · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "ketchup", name: "Кетчуп", label: "Кетчуп · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "mustard", name: "Соус медово-горчичный", label: "Соус медово-горчичный · 30 г", quantity: 30, unit: "g", price: 40 },
  { key: "patty", name: "Котлета говяжья", label: "Котлета говяжья · 110 г", quantity: 110, unit: "g", price: 200 },
  { key: "chicken-patty", name: "Котлета куриная", label: "Котлета куриная · 1 шт.", quantity: 1, unit: "pcs", price: 150 },
  { key: "shrimp", name: "Королевская креветка в панировке", label: "Королевская креветка · 1 шт.", quantity: 1, unit: "pcs", price: 50 },
  { key: "beef", name: "Говядина запечённая", label: "Говядина · 90 г", quantity: 90, unit: "g", price: 300 },
  { key: "pork", name: "Свинина запечённая", label: "Свинина · 90 г", quantity: 90, unit: "g", price: 140 },
  { key: "chicken", name: "Курица запечённая", label: "Курица · 90 г", quantity: 90, unit: "g", price: 110 },
  { key: "sausage-chicken", name: "Колбаска куриная", label: "Колбаска куриная · 80 г", quantity: 1, unit: "pcs", price: 100, note: "Порция 80 г, 1 колбаска. Массу закупочной штуки нужно сверить." },
  { key: "sausage-pork", name: "Колбаска свиная", label: "Колбаска свиная · 80 г", quantity: 1, unit: "pcs", price: 100, note: "Порция 80 г, 1 колбаска. Массу закупочной штуки нужно сверить." },
  { key: "sausage-beef", name: "Колбаска говяжья", label: "Колбаска говяжья · 80 г", quantity: 1, unit: "pcs", price: 160, note: "Порция 80 г, 1 колбаска. Массу закупочной штуки нужно сверить." }
] as const;

export function acceptsExtras(category: string) {
  return ["бургеры", "шаурма", "хот-доги", "хот доги", "боксы", "боксфуд", "горячие закуски", "закуски"].includes(category.trim().toLocaleLowerCase("ru-RU"));
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

export function extraKeysForProduct(name: string, category: string): string[] {
  const product = normalize(name);
  const section = normalize(category);

  if (!acceptsExtras(category)) return [];
  if (product.includes("кревет")) return ["shrimp", "caesar", "garlic"];
  if (section.includes("хот дог") || product.includes("хот дог")) return ["cheddar", "onion", "cheese-sauce"];

  if (section.includes("шаур") || product.includes("шаур")) {
    const meat = product.includes("свинин") ? "pork" : product.includes("говядин") ? "beef" : "chicken";
    return [meat, "cheese-stick", "garlic"];
  }

  if (section.includes("бургер") || product.includes("бургер") || product.includes("ролл") || product === "татарин") {
    const patty = product.includes("чикен") || product.includes("chicken") ? "chicken-patty" : "patty";
    return [patty, "cheese-stick", "jalapeno"];
  }

  if (section.includes("бокс")) {
    const protein = product.includes("кревет") ? "shrimp" : product.includes("свинин") ? "pork" : product.includes("говядин") ? "beef" : "chicken";
    return [protein, "cheese-stick", "garlic"];
  }

  if (product.includes("крыл")) return ["bbq", "garlic", "mustard"];
  if (product.includes("нагг")) return ["cheese-sauce", "bbq", "garlic"];
  return ["cheese-sauce", "bbq", "garlic"];
}
