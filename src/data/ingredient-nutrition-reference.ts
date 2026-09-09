// Data only: never persist over database values. Read-time fallback is handled separately.
// Values are rounded source references per 100 g edible raw food; see the audit.
const foundationSourceURL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip";
const legacySourceURL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip";

export interface IngredientNutritionReference {
  readonly name: string;
  readonly calories_kcal: number;
  readonly proteins_g: number;
  readonly fats_g: number;
  readonly carbohydrates_g: number;
  readonly sourceUrl: string;
  readonly sourceName: string;
  readonly state: string;
  readonly nutrition_basis_quantity: 100;
  readonly unit: "g";
  readonly estimated: true;
  readonly sourceFoodId: number;
  readonly sourceFoodName: string;
  readonly sourceReleaseDate: string;
  readonly sourcePublicationDate: string;
  readonly energyNutrientId: 1008 | 2048;
  readonly carbohydrateDefinition: string;
  readonly date: string;
  readonly condition: string;
}

export const ingredientNutritionReference: readonly IngredientNutritionReference[] = [
  {
    name: "Капуста",
    state: "raw, edible portion, no dressing",
    nutrition_basis_quantity: 100,
    unit: "g",
    calories_kcal: 27.9,
    proteins_g: 0.96,
    fats_g: 0.23,
    carbohydrates_g: 6.38,
    carbohydrateDefinition: "by difference, includes dietary fiber",
    sourceUrl: foundationSourceURL,
    sourceName: "USDA FoodData Central / Foundation Foods",
    sourceFoodId: 2346407,
    sourceFoodName: "Cabbage, green, raw",
    sourceReleaseDate: "2026-04-30",
    sourcePublicationDate: "2022-10-28",
    energyNutrientId: 2048,
    date: "2026-09-10",
    estimated: true,
    condition: "Use only for raw green/white headed cabbage, not red, napa, cooked, or dressed cabbage."
  },
  {
    name: "Помидор",
    state: "raw, red and ripe, edible portion, no dressing",
    nutrition_basis_quantity: 100,
    unit: "g",
    calories_kcal: 18,
    proteins_g: 0.88,
    fats_g: 0.2,
    carbohydrates_g: 3.89,
    carbohydrateDefinition: "by difference, includes dietary fiber",
    sourceUrl: legacySourceURL,
    sourceName: "USDA FoodData Central / SR Legacy",
    sourceFoodId: 170457,
    sourceFoodName: "Tomatoes, red, ripe, raw, year round average",
    sourceReleaseDate: "2018-04",
    sourcePublicationDate: "2019-04-01",
    energyNutrientId: 1008,
    date: "2026-09-10",
    estimated: true,
    condition: "Generic red ripe tomato; no cultivar or supplier-lot claim."
  },
  {
    name: "Огурец свежий",
    state: "raw, with peel, edible portion, no dressing",
    nutrition_basis_quantity: 100,
    unit: "g",
    calories_kcal: 13.9,
    proteins_g: 0.63,
    fats_g: 0.18,
    carbohydrates_g: 2.95,
    carbohydrateDefinition: "by difference, includes dietary fiber",
    sourceUrl: foundationSourceURL,
    sourceName: "USDA FoodData Central / Foundation Foods",
    sourceFoodId: 2346406,
    sourceFoodName: "Cucumber, with peel, raw",
    sourceReleaseDate: "2026-04-30",
    sourcePublicationDate: "2022-10-28",
    energyNutrientId: 2048,
    date: "2026-09-10",
    estimated: true,
    condition: "The local food-cost note specifies unpeeled cucumber; not suitable for peeled or pickled cucumber."
  },
  {
    name: "Лук красный",
    state: "raw, red onion, edible portion, no dressing",
    nutrition_basis_quantity: 100,
    unit: "g",
    calories_kcal: 44,
    proteins_g: 0.94,
    fats_g: 0.1,
    carbohydrates_g: 9.93,
    carbohydrateDefinition: "by difference, includes dietary fiber",
    sourceUrl: foundationSourceURL,
    sourceName: "USDA FoodData Central / Foundation Foods",
    sourceFoodId: 790577,
    sourceFoodName: "Onions, red, raw",
    sourceReleaseDate: "2026-04-30",
    sourcePublicationDate: "2020-04-01",
    energyNutrientId: 1008,
    date: "2026-09-10",
    estimated: true,
    condition: "Exact raw red onion name only. Do not match the extras catalog key onion, which means fried onion."
  }
] as const;
