import type { EconomicsValues } from "./economics-values";

export type ManagementExpenseInputs = {
  acquiringPosPercent: number;
  acquiringWebPercent: number;
  capex: number;
  marketing: number;
  miscPercent: number;
  other: number;
  payroll: number;
  rent: number;
  royaltyPercent: number;
  taxPercent: number;
  utilities: number;
};

export function createManagementExpenseDefaults(values: EconomicsValues, calendarDays: number): ManagementExpenseInputs {
  const periodFactor = Math.max(1, calendarDays) / 30.4375;
  const period = (value: number) => Math.round(value * periodFactor * 100) / 100;
  return {
    acquiringPosPercent: values.acquiring_percent,
    acquiringWebPercent: values.acquiring_percent,
    capex: 0,
    marketing: period(values.marketing),
    miscPercent: values.misc_percent,
    other: period(values.other_expenses),
    payroll: period(values.payroll),
    rent: period(values.rent),
    royaltyPercent: 0,
    taxPercent: values.tax_percent,
    utilities: period(values.utilities)
  };
}

export function calculateManagementResult(
  actual: {
    coveredRevenue: number;
    grossProfit: number;
    posCoveredRevenue: number;
    webCoveredRevenue: number;
  },
  expenses: ManagementExpenseInputs
) {
  const fixedOpex = expenses.rent + expenses.payroll + expenses.utilities + expenses.marketing + expenses.other;
  const posAcquiring = actual.posCoveredRevenue * expenses.acquiringPosPercent / 100;
  const webAcquiring = actual.webCoveredRevenue * expenses.acquiringWebPercent / 100;
  const tax = actual.coveredRevenue * expenses.taxPercent / 100;
  const royalty = actual.coveredRevenue * expenses.royaltyPercent / 100;
  const misc = actual.coveredRevenue * expenses.miscPercent / 100;
  const commissions = posAcquiring + webAcquiring + tax + royalty + misc;
  const operatingResult = actual.grossProfit - fixedOpex - commissions;
  return {
    cashResult: operatingResult - expenses.capex,
    commissions,
    fixedOpex,
    misc,
    operatingResult,
    posAcquiring,
    royalty,
    tax,
    webAcquiring
  };
}
