import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { buildSalesWhere } from "@/lib/analytics/query";
import type { AnalyticsFilters, AnalyticsRange, AnalyticsScope } from "@/lib/analytics/types";

type RevenueRow = {
  revenue: string | number;
  pos_revenue: string | number;
  web_revenue: string | number;
  sales: string | number;
};

type CostRow = {
  covered_revenue: string | number;
  pos_covered_revenue: string | number;
  web_covered_revenue: string | number;
  food_cost: string | number;
  total_item_revenue: string | number;
};

export type ActualManagementResult = {
  coveredRevenue: number;
  foodCost: number;
  foodCostCoveragePercent: number;
  grossProfit: number;
  otherCoveredRevenue: number;
  posCoveredRevenue: number;
  posRevenue: number;
  revenue: number;
  sales: number;
  uncoveredRevenue: number;
  webCoveredRevenue: number;
  webRevenue: number;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getActualManagementResult(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
}): Promise<ActualManagementResult> {
  const where = buildSalesWhere(params.filters, params.range, params.scope, {
    alias: "s",
    includedOnly: true,
    includeItemFilters: false
  });
  const sql = getPostgresSql();
  const [revenueRows, costRows] = await Promise.all([
    sql.unsafe<RevenueRow[]>(`
      select
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        coalesce(sum(s.net_revenue) filter (where s.source = 'pos_evotor'), 0)::numeric as pos_revenue,
        coalesce(sum(s.net_revenue) filter (where s.source = 'web'), 0)::numeric as web_revenue,
        count(*) filter (where s.sale_count_eligible)::integer as sales
      from public.canonical_analytics_sales s
      where ${where.text}
    `, where.values as never[]),
    sql.unsafe<CostRow[]>(`
      with product_food_costs as (
        select
          recipe.product_id,
          count(*) > 0 and bool_and(
            ingredient.cost_per_unit > 0 and recipe.unit = ingredient.unit
          ) as is_complete,
          sum(
            recipe.quantity
            / (1 - least(95, greatest(0, coalesce(ingredient.waste_percent, 0))) / 100)
            * ingredient.cost_per_unit
          )::numeric as unit_food_cost
        from public.product_ingredients recipe
        join public.ingredients ingredient on ingredient.id = recipe.ingredient_id
        group by recipe.product_id
      )
      select
        coalesce(sum(i.net_revenue) filter (
          where i.product_id is not null and coalesce(product_cost.is_complete, false)
        ), 0)::numeric as covered_revenue,
        coalesce(sum(i.net_revenue) filter (
          where s.source = 'pos_evotor'
            and i.product_id is not null
            and coalesce(product_cost.is_complete, false)
        ), 0)::numeric as pos_covered_revenue,
        coalesce(sum(i.net_revenue) filter (
          where s.source = 'web'
            and i.product_id is not null
            and coalesce(product_cost.is_complete, false)
        ), 0)::numeric as web_covered_revenue,
        coalesce(sum(i.net_quantity * product_cost.unit_food_cost) filter (
          where i.product_id is not null and coalesce(product_cost.is_complete, false)
        ), 0)::numeric as food_cost,
        coalesce(sum(abs(i.net_revenue)), 0)::numeric as total_item_revenue
      from public.analytics_sale_items i
      join public.canonical_analytics_sales s on s.sale_id = i.sale_id
      left join product_food_costs product_cost on product_cost.product_id = i.product_id
      where ${where.text}
    `, where.values as never[])
  ]);
  const revenue = number(revenueRows[0]?.revenue);
  const coveredRevenue = number(costRows[0]?.covered_revenue);
  const posCoveredRevenue = number(costRows[0]?.pos_covered_revenue);
  const webCoveredRevenue = number(costRows[0]?.web_covered_revenue);
  const totalItemRevenue = number(costRows[0]?.total_item_revenue);
  const foodCost = number(costRows[0]?.food_cost);

  return {
    coveredRevenue,
    foodCost,
    foodCostCoveragePercent: totalItemRevenue > 0
      ? Math.min(100, Math.abs(coveredRevenue) / totalItemRevenue * 100)
      : 0,
    grossProfit: coveredRevenue - foodCost,
    otherCoveredRevenue: Math.max(0, coveredRevenue - posCoveredRevenue - webCoveredRevenue),
    posCoveredRevenue,
    posRevenue: number(revenueRows[0]?.pos_revenue),
    revenue,
    sales: number(revenueRows[0]?.sales),
    uncoveredRevenue: Math.max(0, revenue - coveredRevenue),
    webCoveredRevenue,
    webRevenue: number(revenueRows[0]?.web_revenue)
  };
}
