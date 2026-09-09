import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { buildPurchasePlan, type PlanningIngredient, type PlanningRecipe, type PlanningSale } from "./planning-math";
import { addCalendarDays, getDateKey, startOfZonedDay } from "./periods";
import { getAnalyticsScope } from "./permissions";

export const PLANNING_HORIZONS = [1, 2, 3, 7, 14] as const;
export const PLANNING_HISTORY = [28, 56, 84] as const;

export function parsePlanningOptions(params: Record<string, string | string[] | undefined>) {
  const value = (key: string) => Number(Array.isArray(params[key]) ? params[key][0] : params[key]);
  return {
    horizon: PLANNING_HORIZONS.includes(value("days") as never) ? value("days") : 7,
    history: PLANNING_HISTORY.includes(value("history") as never) ? value("history") : 28,
    bufferDays: [0, 1, 2, 3, 7].includes(value("buffer")) ? value("buffer") : 1
  };
}

export async function getPurchasePlanning(options: ReturnType<typeof parsePlanningOptions>, now = new Date()) {
  const scope = await getAnalyticsScope();
  // Stock is currently one shared pool, not a per-location ledger.
  if (scope.locationIds !== null) throw new Error("planning_requires_unrestricted_stock_scope");
  const today = getDateKey(now);
  const from = addCalendarDays(today, -options.history);
  const result = await getPostgresSql().begin(async (sql) => {
    await sql.unsafe("set transaction isolation level repeatable read, read only");
    await sql.unsafe("set local statement_timeout = '12s'");
    const sales = await sql<PlanningSale[]>`
      select i.product_id::text as "productId", coalesce(p.name, i.product_name) as name,
        extract(dow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
        sum(i.quantity)::float8 as quantity, coalesce(p.is_active, false) as active
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      left join public.products p on p.id = i.product_id
      where s.analytics_included and s.sale_count_eligible and i.operation_type = 'sale'
        and s.analytics_at >= ${startOfZonedDay(from).toISOString()}::timestamptz
        and s.analytics_at < ${startOfZonedDay(today).toISOString()}::timestamptz
      group by i.product_id, coalesce(p.name, i.product_name), 3, p.is_active
    `;
    const counts = await sql<{ sales: number; active_days: number }[]>`
      select count(*)::integer as sales,
        count(distinct (s.analytics_at at time zone 'Europe/Moscow')::date)::integer as active_days
      from public.canonical_analytics_sales s
      where s.analytics_included and s.sale_count_eligible and s.operation_type = 'sale'
        and s.analytics_at >= ${startOfZonedDay(from).toISOString()}::timestamptz
        and s.analytics_at < ${startOfZonedDay(today).toISOString()}::timestamptz
    `;
    const ids = [...new Set(sales.filter((row) => row.active && row.productId).map((row) => row.productId!))];
    const recipes = ids.length ? await sql<PlanningRecipe[]>`
      select product_id::text as "productId", ingredient_id::text as "ingredientId", quantity::float8, unit
      from public.product_ingredients where product_id = any(${ids}::uuid[])
    ` : [];
    const ingredientIds = [...new Set(recipes.map((row) => row.ingredientId))];
    const ingredients = ingredientIds.length ? await sql<PlanningIngredient[]>`
      select i.id::text, i.name, i.unit, i.waste_percent::float8 as "wastePercent",
        i.cost_per_unit::float8 as cost, i.package_size::float8 as "packageSize", i.is_active as active,
        case when stock.is_active then stock.current_quantity::float8 end as stock,
        coalesce(stock.reserved_quantity, 0)::float8 as reserved,
        coalesce(stock.min_quantity, 0)::float8 as minimum
      from public.ingredients i
      left join public.inventory_items stock on stock.ingredient_id = i.id and stock.unit = i.unit
      where i.id = any(${ingredientIds}::uuid[])
    ` : [];
    return { sales, counts: counts[0], recipes, ingredients };
  });
  const futureWeekdays = Array.from({ length: 366 }, (_, index) => new Date(`${addCalendarDays(today, index)}T12:00:00Z`).getUTCDay());
  return { ...buildPurchasePlan({ ...result, ...options, weekdaySamples: Array<number>(7).fill(options.history / 7), futureWeekdays }),
    from, through: addCalendarDays(today, -1), today, options,
    averageOrders: (result.counts?.sales ?? 0) / options.history, activeDays: result.counts?.active_days ?? 0 };
}
