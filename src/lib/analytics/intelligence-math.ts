import { calculateMetricDelta, safeAverage } from "./metrics";
import type { AnalyticsParetoSummary, KpiValue } from "./types";

type ProductValue = { key: string; name: string; revenue: number; quantity: number };

export function buildPareto(
  products: ProductValue[],
  thresholds: { a: number; b: number } = { a: 80, b: 95 }
): AnalyticsParetoSummary {
  const sorted = [...products].filter((row) => row.revenue > 0).sort((left, right) => right.revenue - left.revenue);
  const total = sorted.reduce((sum, row) => sum + row.revenue, 0);
  let cumulative = 0;
  const rows = sorted.map((row) => {
    cumulative += row.revenue;
    const cumulativeShare = total > 0 ? (cumulative / total) * 100 : 0;
    return {
      ...row,
      cumulativeShare,
      abc: cumulativeShare <= thresholds.a ? "A" as const : cumulativeShare <= thresholds.b ? "B" as const : "C" as const
    };
  });
  const productsTo = (share: number) => {
    const index = rows.findIndex((row) => row.cumulativeShare >= share);
    return index === -1 ? rows.length : index + 1;
  };
  return {
    totalProducts: rows.length,
    productsTo50: productsTo(50),
    productsTo80: productsTo(80),
    productsTo90: productsTo(90),
    rows
  };
}

function kpi(current: number, previous: number): KpiValue {
  return {
    current,
    previous,
    delta: calculateMetricDelta(current, previous),
    sparkline: [previous, current]
  };
}

export function buildAverageTicketFactors(current: { sales: number; items: number; saleRevenue: number }, previous: { sales: number; items: number; saleRevenue: number }) {
  return {
    itemsPerReceipt: kpi(safeAverage(current.items, current.sales), safeAverage(previous.items, previous.sales)),
    averageItemValue: kpi(safeAverage(current.saleRevenue, current.items), safeAverage(previous.saleRevenue, previous.items))
  };
}

export function buildRevenueBridge(
  current: { revenue: number; sales: number; saleRevenue: number; refunds: number },
  previous: { revenue: number; sales: number; saleRevenue: number; refunds: number }
) {
  const currentTicket = safeAverage(current.saleRevenue, current.sales);
  const previousTicket = safeAverage(previous.saleRevenue, previous.sales);
  return {
    current: current.revenue,
    previous: previous.revenue,
    receiptEffect: (current.sales - previous.sales) * previousTicket,
    ticketEffect: current.sales * (currentTicket - previousTicket),
    refundChange: -(current.refunds - previous.refunds)
  };
}

export function detectTransparentAnomaly(current: number, history: number[], sigma = 2) {
  if (history.length < 4) return null;
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  const variance = history.reduce((sum, value) => sum + (value - average) ** 2, 0) / history.length;
  const deviation = Math.sqrt(variance);
  if (deviation === 0) return current === average ? null : { average, deviation, score: current > average ? Infinity : -Infinity };
  const score = (current - average) / deviation;
  return Math.abs(score) >= sigma ? { average, deviation, score } : null;
}
