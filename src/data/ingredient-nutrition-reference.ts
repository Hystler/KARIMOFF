// Read-time nutrition fallback. Database values always take priority.
const foundationSourceURL = "https://fdc.nal.usda.gov/download-datasets/";
const srLegacySourceURL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip";
const ownerEvidenceURL = "https://github.com/Hystler/KARIMOFF/blob/main/docs/ingredient-nutrition-sources-2026-09.md";

export interface IngredientNutritionReference {
  readonly name: string;
  readonly calories_kcal: number;
  readonly proteins_g: number;
  readonly fats_g: number;
  readonly carbohydrates_g: number;
  readonly sourceUrl: string;
  readonly sourceName: string;
  readonly state: string;
  readonly nutrition_basis_quantity: number;
  readonly unit: "g" | "ml" | "pcs";
  readonly estimated: boolean;
  readonly condition: string;
  readonly sourceFoodId?: number;
}

const label = (
  name: string,
  unit: "g" | "pcs",
  basis: number,
  calories: number,
  protein: number,
  fat: number,
  carbs: number,
  condition: string
): IngredientNutritionReference => ({
  name,
  unit,
  nutrition_basis_quantity: basis,
  calories_kcal: calories,
  proteins_g: protein,
  fats_g: fat,
  carbohydrates_g: carbs,
  sourceUrl: ownerEvidenceURL,
  sourceName: "Этикетка продукта, фото владельца от 11.09.2026",
  state: "as supplied",
  estimated: false,
  condition
});

const estimated = (
  name: string,
  calories: number,
  protein: number,
  fat: number,
  carbs: number,
  condition: string,
  sourceName = "USDA FoodData Central / Foundation Foods",
  sourceFoodId?: number,
  sourceUrl = foundationSourceURL
): IngredientNutritionReference => ({
  name,
  unit: "g",
  nutrition_basis_quantity: 100,
  calories_kcal: calories,
  proteins_g: protein,
  fats_g: fat,
  carbohydrates_g: carbs,
  sourceUrl,
  sourceName,
  state: "estimated recipe result",
  estimated: true,
  condition,
  sourceFoodId
});

const estimatedPiece = (
  name: string,
  grams: number,
  calories: number,
  protein: number,
  fat: number,
  carbs: number,
  condition: string,
  sourceFoodId: number
): IngredientNutritionReference => {
  const perPiece = (value: number) => Math.round(value * grams) / 100;
  return {
    ...estimated(name, perPiece(calories), perPiece(protein), perPiece(fat), perPiece(carbs), condition),
    unit: "pcs",
    nutrition_basis_quantity: 1,
    sourceUrl: srLegacySourceURL,
    sourceName: "USDA FoodData Central / SR Legacy",
    sourceFoodId
  };
};

export const ingredientNutritionReference: readonly IngredientNutritionReference[] = [
  estimated("Капуста", 27.9, 0.96, 0.23, 6.38, "Сырая белокочанная капуста, съедобная часть без заправки.", undefined, 2346407),
  estimated("Лист салата", 18.5, 1.09, 0.16, 4.07, "Справочное значение для зелёного листового салата."),
  estimated("Помидор", 18, 0.88, 0.2, 3.89, "Сырой спелый красный помидор без заправки."),
  estimated("Огурец свежий", 13.9, 0.63, 0.18, 2.95, "Свежий неочищенный огурец без заправки."),
  estimated("Лук красный", 44, 0.94, 0.1, 9.93, "Сырой красный лук."),
  estimatedPiece("Лаваш", 73, 275, 9.1, 1.2, 55.7, "Тестовый аналог: одна белая пита 73 г; не является данными поставщика.", 174915),
  estimated("Лаваш мини", 275, 9.1, 1.2, 55.7, "Тестовый аналог белой питы; масса готового мини-лаваша 40 г.", "USDA FoodData Central / SR Legacy", 174915, srLegacySourceURL),
  estimatedPiece("Лепёшка", 166, 275, 9.1, 1.2, 55.7, "Тестовый аналог: одна белая пита 166 г; не является данными поставщика.", 174915),
  label("Тортилья", "g", 100, 320, 7.5, 8.5, 52, "Этикетка на 100 г; производственная порция 85 г."),
  estimated(
    "Курица запечённая",
    169.66,
    28.85,
    5.42,
    0,
    "Расчёт на 100 г готового продукта: 10 кг сырой грудки, 250 мл масла, выход 7,8 кг; КБЖУ приправы не учтено."
  ),
  label("Булочка для бургера белая", "pcs", 1, 213.2, 5.33, 2.46, 41, "Одна булочка 82 г; пересчёт этикетки с 100 г."),
  label("Булочка для бургера чёрная", "pcs", 1, 240.3, 6.23, 5.34, 42.72, "Одна булочка 89 г; пересчёт этикетки с 100 г."),
  label("Булочка для хот-дога открытая", "pcs", 1, 156, 4.2, 1.8, 30, "Одна датская булочка 60 г; пересчёт этикетки с 100 г."),
  label("Булочка для хот-дога закрытая", "pcs", 1, 144, 4.8, 0.6, 29.4, "Один французский багет 60 г; пересчёт этикетки с 100 г."),
  label("Котлета говяжья", "g", 100, 260, 13, 23, 1, "Котлета 110 г; КБЖУ этикетки указано на 100 г."),
  estimatedPiece("Бекон жареный", 3, 541, 37, 41.8, 1.43, "Тестовый аналог готового жареного бекона; один ломтик 3 г.", 167712),
  label("Колбаска куриная", "pcs", 1, 168, 12, 12.8, 0.8, "Одна колбаска 80 г; пересчёт этикетки с 100 г."),
  label("Колбаска свиная", "pcs", 1, 240, 5.6, 24, 0.8, "Одна колбаска 80 г; пересчёт этикетки с 100 г."),
  label("Колбаска говяжья", "pcs", 1, 216, 12, 18.4, 0.8, "Одна колбаска 80 г; пересчёт этикетки с 100 г."),
  estimatedPiece("Королевская креветка в панировке", 19, 308, 7.84, 18.9, 28, "Тестовый аналог панированной креветки после фритюра; средняя масса одной штуки 19 г.", 172037),
  label("Наггетс", "pcs", 1, 39.9, 2.09, 2.09, 3.04, "Средняя фактическая масса 19 г из диапазона 18–20 г; пересчёт этикетки с 100 г."),
  label("Огурец маринованный", "g", 100, 15, 1, 0, 4, "Этикетка на 100 г; жиры не указаны и приняты равными 0 г."),
  label("Лук жареный гранулированный", "g", 100, 530, 8.1, 49.5, 47.7, "Этикетка на 100 г."),
  label("Сыр Чеддер, ломтик", "pcs", 1, 33, 1.84, 2.65, 0.45, "Один ломтик 10 г; пересчёт этикетки с 100 г."),
  label("Сырная палочка", "pcs", 1, 41.19, 2.35, 2, 3.5, "Одна палочка 23 г; пересчёт этикетки с 100 г."),
  label("Картофель фри", "g", 100, 140, 2.5, 4.5, 23, "Этикетка замороженного продукта на 100 г."),
  label("Картофель по-деревенски", "g", 100, 140, 2.5, 4.5, 23, "Этикетка замороженного продукта на 100 г."),
  label("Соус Цезарь", "g", 100, 241, 1.3, 23, 3.9, "Этикетка на 100 г."),
  label("Соус сырный", "g", 100, 400, 1, 42, 5, "Этикетка на 100 г."),
  label("Кетчуп", "g", 100, 110, 1, 0, 25, "Этикетка на 100 г; жиры не указаны и приняты равными 0 г."),
  label("Соус барбекю обычный", "g", 100, 120, 0.5, 0, 30.5, "Этикетка на 100 г; жиры не указаны и приняты равными 0 г."),
  label("Майонез 67%", "g", 100, 610, 0.3, 67, 0.8, "Этикетка Peschagin Professional на 100 г."),
  estimated("Соус медово-горчичный", 464, 0.87, 40.8, 23.3, "Тестовый аналог обычной медово-горчичной заправки.", "USDA FoodData Central / SR Legacy", 171043, srLegacySourceURL),
  estimatedPiece("Крыло куриное Барбекю", 46, 321, 26.1, 22.2, 2.39, "Тестовый аналог жареного крыла с кожей и мучной оболочкой; средняя масса одной штуки 46 г.", 173629),
  estimated("Соус фирменный барбекю", 487.5, 0.33, 51.5, 5.34, "Расчёт по рецептуре: майонез 1000 г, обычный барбекю 200 г, базилик 1 г, вода 100 мл, выход 1301 г.", "Этикетки компонентов / расчёт по рецептуре"),
  estimated("Соус Тейсти", 479.48, 0.38, 50.34, 5.87, "Расчёт по рецептуре: майонез 1000 г, барбекю 200 г, горчичный соус 50 г, паприка 1 г, вода 100 мл, выход 1351 г.", "Этикетки компонентов / расчёт по рецептуре"),
  estimated("Соус чесночный", 526.63, 0.33, 57.33, 1.8, "Расчёт по присланной калькуляции: майонез 8000 г, барбекю 266,89 г, чеснок 82,8 г, вода 1000 мл.", "Фото рецептуры владельца / USDA / расчёт")
] as const;
