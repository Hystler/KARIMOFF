export type PlanningUnit = "g" | "ml" | "pcs";
export type PlanningSale = { productId: string | null; name: string; weekday: number; quantity: number; active: boolean };
export type PlanningIngredient = {
  id: string; name: string; unit: PlanningUnit; wastePercent: number;
  cost: number | null; packageSize: number | null; stock: number | null;
  reserved: number; minimum: number; active: boolean;
};
export type PlanningRecipe = { productId: string; ingredientId: string; quantity: number; unit: PlanningUnit };

const finite = (value: number) => Number.isFinite(value) && value >= 0;

export function buildPurchasePlan(input: {
  sales: PlanningSale[]; ingredients: PlanningIngredient[]; recipes: PlanningRecipe[];
  weekdaySamples: number[]; futureWeekdays: number[]; horizon: number; bufferDays: number;
}) {
  if (input.weekdaySamples.length !== 7 || input.weekdaySamples.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error("planning_requires_complete_weeks");
  }
  if (!Number.isInteger(input.horizon) || input.horizon < 1 || input.horizon > 14
    || !Number.isInteger(input.bufferDays) || input.bufferDays < 0 || input.bufferDays > 7
    || input.futureWeekdays.length < input.horizon + input.bufferDays
    || input.futureWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("invalid_planning_horizon");
  }
  const days = input.weekdaySamples.reduce((sum, n) => sum + n, 0);
  const ingredients = new Map(input.ingredients.map((item) => [item.id, item]));
  const recipes = new Map<string, PlanningRecipe[]>();
  for (const line of input.recipes) recipes.set(line.productId, [...(recipes.get(line.productId) ?? []), line]);
  const demand = new Map<string, { name: string; quantity: number; weekdays: number[]; active: boolean; productId: string | null }>();
  for (const sale of input.sales) {
    if (!finite(sale.quantity) || !Number.isInteger(sale.weekday) || sale.weekday < 0 || sale.weekday > 6) throw new Error("invalid_planning_sale");
    const key = sale.productId ?? `unmapped:${sale.name}`;
    const product = demand.get(key) ?? { name: sale.name, quantity: 0, weekdays: Array<number>(7).fill(0), active: sale.active, productId: sale.productId };
    product.quantity += sale.quantity;
    product.weekdays[sale.weekday] += sale.quantity;
    demand.set(key, product);
  }
  const ingredientDemand = new Map<string, number[]>();
  const products = [...demand.values()].map((product) => {
    const lines = product.productId ? recipes.get(product.productId) ?? [] : [];
    const complete = lines.length > 0 && lines.every((line) => {
      const ingredient = ingredients.get(line.ingredientId);
      return ingredient?.active && ingredient.unit === line.unit && finite(line.quantity) && line.quantity > 0
        && finite(ingredient.wastePercent) && ingredient.wastePercent < 100;
    });
    const issue = !product.productId ? "Не сопоставлен" : !product.active ? "Снят с продажи" : !complete ? "Неполная рецептура" : null;
    const rates = product.weekdays.map((q, day) => q / input.weekdaySamples[day]);
    const forecast = input.futureWeekdays.slice(0, input.horizon).reduce((sum, day) => sum + rates[day], 0);
    if (!issue) {
      for (const line of lines) {
        const ingredient = ingredients.get(line.ingredientId)!;
        const gross = line.quantity / (1 - ingredient.wastePercent / 100);
        const ratesForIngredient = ingredientDemand.get(ingredient.id) ?? Array<number>(7).fill(0);
        for (let day = 0; day < 7; day++) ratesForIngredient[day] += rates[day] * gross;
        ingredientDemand.set(ingredient.id, ratesForIngredient);
      }
    }
    return { id: product.productId, name: product.name, sold: product.quantity, perDay: product.quantity / days, forecast, issue };
  }).sort((a, b) => b.sold - a.sold);
  const rows = [...ingredientDemand].map(([id, rates]) => {
    const ingredient = ingredients.get(id)!;
    const demandFor = (count: number) => input.futureWeekdays.slice(0, count).reduce((sum, day) => sum + rates[day], 0);
    const demand = demandFor(input.horizon);
    const target = demandFor(input.horizon + input.bufferDays) + Math.max(0, ingredient.minimum);
    const available = ingredient.stock !== null && finite(ingredient.stock) && finite(ingredient.reserved)
      ? Math.max(0, ingredient.stock - ingredient.reserved) : null;
    const shortage = available === null ? null : Math.max(0, target - available);
    const size = ingredient.packageSize !== null && finite(ingredient.packageSize) && ingredient.packageSize > 0 ? ingredient.packageSize : null;
    const packages = shortage === null || size === null ? null : Math.ceil(Math.max(0, shortage / size - 1e-9));
    const purchase = shortage === null ? null : packages !== null && size !== null ? packages * size : ingredient.unit === "pcs" ? Math.ceil(shortage - 1e-9) : shortage;
    const cost = ingredient.cost !== null && finite(ingredient.cost) && ingredient.cost > 0 ? ingredient.cost : null;
    let daysLeft: number | null = null;
    if (available !== null && rates.some((rate) => rate > 0)) {
      let left = available;
      for (let day = 0; day < input.futureWeekdays.length; day++) {
        const consumption = rates[input.futureWeekdays[day]];
        if (consumption > left) { daysLeft = day + left / consumption; break; }
        left -= consumption;
      }
    }
    return { id, name: ingredient.name, unit: ingredient.unit, demand, target, available,
      perDay: rates.reduce((sum, n) => sum + n, 0) / 7, daysLeft, shortage, packages, purchase,
      budget: purchase !== null && cost !== null ? purchase * cost : null };
  }).sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name, "ru"));
  const totalUnits = products.reduce((sum, p) => sum + p.sold, 0);
  const coveredUnits = products.filter((p) => !p.issue).reduce((sum, p) => sum + p.sold, 0);
  return { rows, products, days, totalUnits, coveredUnits,
    coverage: totalUnits > 0 ? coveredUnits / totalUnits * 100 : null,
    knownBudget: rows.reduce((sum, row) => sum + (row.budget ?? 0), 0),
    missingStock: rows.filter((row) => row.available === null).length,
    missingPrices: rows.filter((row) => row.purchase !== null && row.purchase > 0 && row.budget === null).length };
}
