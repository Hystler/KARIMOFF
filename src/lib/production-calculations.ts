export const productionUnits = ["g", "kg", "ml", "l", "pcs"] as const;
export type ProductionUnit = (typeof productionUnits)[number];
export type BaseProductionUnit = "g" | "ml" | "pcs";

export type ProductionCostComponent = {
  costPerBaseUnit: number;
  isPrimary?: boolean;
  quantity: number;
  unit: ProductionUnit;
};

export type ProductionDirectExpense = {
  amountPerBatch: number;
};

export type ProductionMetricsInput = {
  batchDurationMinutes: number;
  components: ProductionCostComponent[];
  directExpenses: ProductionDirectExpense[];
  monthlyOverhead: number;
  outputQuantity: number;
  outputUnit: ProductionUnit;
  plannedBatchesPerMonth: number;
  salePricePerOutputUnit: number;
  totalPlannedMinutes: number;
};

export function productionUnitFamily(unit: string) {
  if (unit === "g" || unit === "kg") return "mass" as const;
  if (unit === "ml" || unit === "l") return "volume" as const;
  if (unit === "pcs") return "pieces" as const;
  return "unsupported" as const;
}

export function toBaseProductionQuantity(quantity: number, unit: ProductionUnit) {
  return unit === "kg" || unit === "l" ? quantity * 1000 : quantity;
}

export function getBaseProductionUnit(unit: ProductionUnit): BaseProductionUnit {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "pcs";
}

export function getCostPerOutputUnit(costPerBaseUnit: number, outputUnit: ProductionUnit) {
  return outputUnit === "kg" || outputUnit === "l" ? costPerBaseUnit * 1000 : costPerBaseUnit;
}

export function calculateProductionMetrics(input: ProductionMetricsInput) {
  const materialCost = input.components.reduce(
    (sum, component) => sum + toBaseProductionQuantity(component.quantity, component.unit) * component.costPerBaseUnit,
    0
  );
  const directCost = input.directExpenses.reduce(
    (sum, expense) => sum + Math.max(0, expense.amountPerBatch),
    0
  );
  const outputBaseQuantity = toBaseProductionQuantity(input.outputQuantity, input.outputUnit);
  const overheadPerBatch =
    input.totalPlannedMinutes > 0
      ? Math.max(0, input.monthlyOverhead) * Math.max(0, input.batchDurationMinutes) / input.totalPlannedMinutes
      : 0;
  const totalCost = materialCost + directCost + overheadPerBatch;
  const costPerBaseUnit = outputBaseQuantity > 0 ? totalCost / outputBaseQuantity : 0;
  const costPerOutputUnit = getCostPerOutputUnit(costPerBaseUnit, input.outputUnit);
  const plannedRevenue = Math.max(0, input.outputQuantity) * Math.max(0, input.salePricePerOutputUnit);
  const grossProfit = plannedRevenue - totalCost;
  const grossMarginPercent = plannedRevenue > 0 ? grossProfit / plannedRevenue * 100 : null;
  const primaryInput = input.components.find((component) => component.isPrimary);
  const primaryInputBaseQuantity = primaryInput
    ? toBaseProductionQuantity(primaryInput.quantity, primaryInput.unit)
    : null;
  const compatibleYield =
    primaryInput && productionUnitFamily(primaryInput.unit) === productionUnitFamily(input.outputUnit);
  const yieldPercent = compatibleYield && primaryInputBaseQuantity && primaryInputBaseQuantity > 0
    ? outputBaseQuantity / primaryInputBaseQuantity * 100
    : null;
  const lossPercent = yieldPercent === null ? null : 100 - yieldPercent;

  return {
    costPer100BaseUnits: costPerBaseUnit * 100,
    costPerBaseUnit,
    costPerOutputUnit,
    directCost,
    grossMarginPercent,
    grossProfit,
    lossPercent,
    materialCost,
    outputBaseQuantity,
    overheadPerBatch,
    plannedMonthlyGrossProfit: grossProfit * Math.max(0, input.plannedBatchesPerMonth),
    plannedMonthlyRevenue: plannedRevenue * Math.max(0, input.plannedBatchesPerMonth),
    plannedRevenue,
    primaryInputBaseQuantity,
    totalCost,
    yieldPercent
  };
}
