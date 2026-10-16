export type PlanningUnit = "g" | "ml" | "pcs";
export const PLANNING_HORIZONS = [1, 2, 3, 7, 14, 30] as const;
export type PlanningComponent = { ingredientId: string; quantity: number; unit: string; wasteIncluded?: boolean };
export type PlanningSale = {
  productId: string | null; name: string; weekday: number; quantity: number; active: boolean;
  recipeIssue?: string | null; revenue?: number; key?: string; sku?: string | null;
  composition?: PlanningComponent[]; compositionSource?: string; mappingStatus?: string; baseRecipePresent?: boolean;
};
export type PlanningIngredient = {
  id: string; name: string; unit: string; wastePercent: number;
  cost: number | null; packageSize: number | null; stock: number | null;
  reserved: number; minimum: number; active: boolean;
};
export type PlanningRecipe = { productId: string; ingredientId: string; quantity: number; unit: PlanningUnit };

const finite = (value: number) => Number.isFinite(value) && value >= 0;

export function planningQuantity(quantity: number, unit: string, target: string): number | null {
  if (!finite(quantity)) return null;
  const units: Record<string, [string, number]> = { g: ["g", 1], kg: ["g", 1000], ml: ["ml", 1], l: ["ml", 1000], pcs: ["pcs", 1] };
  const from = Object.hasOwn(units, unit) ? units[unit] : undefined;
  const to = Object.hasOwn(units, target) ? units[target] : undefined;
  const amount = from && to && from[0] === to[0] ? quantity * from[1] / to[1] : NaN;
  return Number.isFinite(amount) ? amount : null;
}

export function normalizePlanningIngredient(ingredient: PlanningIngredient): PlanningIngredient {
  const factor = ingredient.unit === "kg" || ingredient.unit === "l" ? 1000 : 1;
  if (factor === 1) return ingredient;
  return { ...ingredient, unit: ingredient.unit === "kg" ? "g" : "ml",
    stock: ingredient.stock === null ? null : ingredient.stock * factor,
    reserved: ingredient.reserved * factor, minimum: ingredient.minimum * factor,
    packageSize: ingredient.packageSize === null ? null : ingredient.packageSize * factor,
    cost: ingredient.cost === null ? null : ingredient.cost / factor };
}

export function buildPurchasePlan(input: {
  sales: PlanningSale[]; ingredients: PlanningIngredient[]; recipes: PlanningRecipe[];
  weekdaySamples: number[]; futureWeekdays: number[]; horizon: number; bufferDays: number;
}) {
  if (input.weekdaySamples.length !== 7 || input.weekdaySamples.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error("planning_requires_complete_weeks");
  }
  if (!PLANNING_HORIZONS.includes(input.horizon as never)
    || !Number.isInteger(input.bufferDays) || input.bufferDays < 0 || input.bufferDays > 7
    || input.futureWeekdays.length < input.horizon + input.bufferDays
    || input.futureWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("invalid_planning_horizon");
  }
  const days = input.weekdaySamples.reduce((sum, n) => sum + n, 0);
  const ingredients = new Map(input.ingredients.map((item) => [item.id, normalizePlanningIngredient(item)]));
  const recipes = new Map<string, PlanningRecipe[]>();
  for (const line of input.recipes) recipes.set(line.productId, [...(recipes.get(line.productId) ?? []), line]);
  const demand = new Map<string, { name: string; quantity: number; revenue: number; weekdays: number[];
    active: boolean; productId: string | null; recipeIssue: string | null; lines: PlanningComponent[];
    source: string; sku: string | null; mappingStatus: string; key: string; recipePresent: boolean }>();
  for (const sale of input.sales) {
    if (!finite(sale.quantity) || !Number.isInteger(sale.weekday) || sale.weekday < 0 || sale.weekday > 6) throw new Error("invalid_planning_sale");
    if (sale.revenue !== undefined && !finite(sale.revenue)) throw new Error("invalid_planning_revenue");
    const lines: PlanningComponent[] = sale.composition ?? (sale.productId ? recipes.get(sale.productId) ?? [] : []);
    const signature = JSON.stringify(lines.map((line) => [line.ingredientId, line.quantity, line.unit, Boolean(line.wasteIncluded)]).sort());
    const key = `${sale.key ?? sale.productId ?? `unmapped:${sale.name}`}:${sale.recipeIssue ?? "base"}:${sale.active}:${signature}`;
    const product = demand.get(key) ?? { name: sale.name, quantity: 0, revenue: 0, weekdays: Array<number>(7).fill(0),
      active: sale.active, productId: sale.productId, recipeIssue: sale.recipeIssue ?? null, lines,
      source: sale.compositionSource ?? "Базовая техкарта", sku: sale.sku ?? null, mappingStatus: sale.mappingStatus ?? "", key,
      recipePresent: Boolean(sale.baseRecipePresent) || lines.some((line) => line.quantity > 0) };
    product.quantity += sale.quantity;
    product.revenue += sale.revenue ?? 0;
    product.weekdays[sale.weekday] += sale.quantity;
    demand.set(key, product);
  }
  const ingredientDemand = new Map<string, number[]>();
  const products = [...demand.values()].map((product) => {
    const lines = product.lines;
    const nonzeroIds = lines.filter((line) => line.quantity !== 0).map((line) => line.ingredientId);
    const duplicate = new Set(nonzeroIds).size !== nonzeroIds.length;
    const complete = !duplicate && lines.some((line) => line.quantity > 0) && lines.every((line) => {
      if (line.quantity === 0) return true;
      const ingredient = ingredients.get(line.ingredientId);
      return ingredient?.active && planningQuantity(line.quantity, line.unit, ingredient.unit) !== null
        && (line.wasteIncluded || (finite(ingredient.wastePercent) && ingredient.wastePercent < 100));
    });
    const invalidLine = lines.find((line) => line.quantity !== 0 && (!ingredients.get(line.ingredientId)?.active
      || planningQuantity(line.quantity, line.unit, ingredients.get(line.ingredientId)?.unit ?? "") === null));
    const issue = product.recipeIssue ?? (!product.productId && !product.source.startsWith("SKU") ? "Не сопоставлен"
      : !product.active ? "Снят с продажи" : duplicate ? "Дубли компонентов требуют проверки" : !complete ? "Неполная рецептура" : null);
    const detail = issue ? invalidLine ? `Проверьте ингредиент ${ingredients.get(invalidLine.ingredientId)?.name ?? invalidLine.ingredientId}, количество и единицу ${invalidLine.unit}`
      : !lines.some((line) => line.quantity > 0) ? "Нет подтверждённых ненулевых компонентов" : issue : null;
    const rates = product.weekdays.map((q, day) => q / input.weekdaySamples[day]);
    const forecast = input.futureWeekdays.slice(0, input.horizon).reduce((sum, day) => sum + rates[day], 0);
    if (!issue) {
      for (const line of lines) {
        if (line.quantity === 0) continue;
        const ingredient = ingredients.get(line.ingredientId)!;
        const amount = planningQuantity(line.quantity, line.unit, ingredient.unit)!;
        const gross = line.wasteIncluded ? amount : amount / (1 - ingredient.wastePercent / 100);
        const ratesForIngredient = ingredientDemand.get(ingredient.id) ?? Array<number>(7).fill(0);
        for (let day = 0; day < 7; day++) ratesForIngredient[day] += rates[day] * gross;
        ingredientDemand.set(ingredient.id, ratesForIngredient);
      }
    }
    return { id: product.productId, key: product.key, name: product.name, sold: product.quantity, revenue: product.revenue,
      perDay: product.quantity / days, forecast, issue, detail, recipePresent: product.recipePresent,
      compositionSource: product.source, sku: product.sku, mappingStatus: product.mappingStatus,
      components: !issue ? lines.filter((line) => line.quantity > 0).map((line) => {
        const ingredient = ingredients.get(line.ingredientId)!;
        const amount = planningQuantity(line.quantity, line.unit, ingredient.unit)!;
        return { ingredientId: ingredient.id, name: ingredient.name, unit: ingredient.unit,
          gross: line.wasteIncluded ? amount : amount / (1 - ingredient.wastePercent / 100) };
      }) : [] };
  }).sort((a, b) => b.sold - a.sold);
  const rows = [...ingredientDemand].map(([id, rates]) => {
    const ingredient = ingredients.get(id)!;
    const demandFor = (count: number) => input.futureWeekdays.slice(0, count).reduce((sum, day) => sum + rates[day], 0);
    const demand = demandFor(input.horizon);
    const target = demandFor(input.horizon + input.bufferDays) + Math.max(0, ingredient.minimum);
    const netStock = ingredient.stock !== null && Number.isFinite(ingredient.stock) && finite(ingredient.reserved)
      ? ingredient.stock - ingredient.reserved : null;
    const available = netStock === null ? null : Math.max(0, netStock);
    const stockDeficit = netStock === null ? null : Math.max(0, -netStock);
    const shortage = netStock === null ? null : Math.max(0, target - netStock);
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
    return { id, name: ingredient.name, unit: ingredient.unit, demand, target, available, recordedStock: ingredient.stock,
      reserved: ingredient.reserved, minimum: ingredient.minimum, stockDeficit, unitCost: cost, packageSize: size,
      perDay: rates.reduce((sum, n) => sum + n, 0) / 7, daysLeft, shortage, packages, purchase,
      budget: purchase === 0 ? 0 : purchase !== null && cost !== null ? purchase * cost : null };
  }).sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name, "ru"));
  const totalUnits = products.reduce((sum, p) => sum + p.sold, 0);
  const coveredUnits = products.filter((p) => !p.issue).reduce((sum, p) => sum + p.sold, 0);
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const coveredRevenue = products.filter((p) => !p.issue).reduce((sum, p) => sum + p.revenue, 0);
  const missingStock = rows.filter((row) => row.available === null).length;
  const missingPrices = rows.filter((row) => row.purchase !== null && row.purchase > 0 && row.budget === null).length;
  const missingPackages = rows.filter((row) => row.purchase !== null && row.purchase > 0 && row.packageSize === null).length;
  return { rows, products, days, totalUnits, coveredUnits, totalRevenue, coveredRevenue,
    revenueCoverage: totalRevenue > 0 ? coveredRevenue / totalRevenue * 100 : null,
    budgetComplete: products.every((p) => !p.issue) && !missingStock && !missingPrices && !missingPackages,
    coverage: totalUnits > 0 ? coveredUnits / totalUnits * 100 : null,
    knownBudget: rows.reduce((sum, row) => sum + (row.budget ?? 0), 0),
    missingStock,
    negativeStock: rows.filter((row) => row.recordedStock !== null && row.recordedStock < 0).length,
    stockDeficits: rows.filter((row) => row.stockDeficit !== null && row.stockDeficit > 0).length,
    missingPrices, missingPackages };
}
