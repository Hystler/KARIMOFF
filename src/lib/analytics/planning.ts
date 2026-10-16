import "server-only";

import type { TransactionSql } from "postgres";
import { getPostgresSql } from "@/lib/postgres/server";
import { buildPurchasePlan, PLANNING_HORIZONS, type PlanningIngredient, type PlanningRecipe } from "./planning-math";
import { resolvePlanningSales, type PlanningOption, type PlanningPosition, type PlanningProduct } from "./planning-composition";
import { addCalendarDays, getDateKey, startOfZonedDay } from "./periods";
import { getAnalyticsScope } from "./permissions";

export { PLANNING_HORIZONS } from "./planning-math";
export const PLANNING_HISTORY = [28, 56, 84] as const;

const planningWindow = `s.analytics_included and s.sale_count_eligible and i.operation_type = 'sale'
  and s.analytics_at >= $1::timestamptz and s.analytics_at < $2::timestamptz`;

// One canonical position remains one row. Receipt/snapshot joins cannot multiply sales.
export const PLANNING_POSITIONS_SQL = `
  select i.product_id::text as "productId", i.product_name as name,
    extract(dow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
    i.quantity::float8 as quantity, i.net_revenue::float8 as revenue, i.source,
    i.mapping_status as "mappingStatus", receipt_item.evotor_product_id as sku,
    store.evotor_store_id as "storeId", receipt_item.name as "receiptName",
    receipt.closed_at::text as "closedAt",
    coalesce(receipt_item.raw_metadata->'sub_positions', '[]'::jsonb) <> '[]'::jsonb
      or coalesce(receipt_item.raw_metadata->'extra_keys', '[]'::jsonb) <> '[]'::jsonb as compound,
    coalesce(snapshot.lines, '[]'::jsonb) as snapshot
  from public.canonical_analytics_sales s
  join public.analytics_sale_items i on i.sale_id = s.sale_id
  left join public.evotor_receipt_items receipt_item on i.source = 'pos_evotor' and receipt_item.id = i.source_record_id
  left join public.evotor_receipts receipt on receipt.id = receipt_item.receipt_id
  left join public.evotor_stores store on store.id = receipt.store_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('ingredientId', usage.ingredient_id::text,
      'quantity', usage.quantity_per_item, 'unit', usage.unit) order by usage.ingredient_id) as lines
    from public.order_item_ingredient_usage usage
    where i.source = 'web' and usage.order_item_id = i.source_record_id
  ) snapshot on true
  where ${planningWindow}
`;

export const PLANNING_TOTALS_SQL = `
  select coalesce(sum(i.quantity), 0)::float8 as quantity, coalesce(sum(i.net_revenue), 0)::float8 as revenue
  from public.canonical_analytics_sales s
  join public.analytics_sale_items i on i.sale_id = s.sale_id where ${planningWindow}
`;

export async function loadPlanningInputs(sql: TransactionSql, from: string, today: string) {
  const values = [startOfZonedDay(from).toISOString(), startOfZonedDay(today).toISOString()];
  const positions = await sql.unsafe<PlanningPosition[]>(PLANNING_POSITIONS_SQL, values);
  const [totals] = await sql.unsafe<{ quantity: number; revenue: number }[]>(PLANNING_TOTALS_SQL, values);
  const counts = await sql<{ sales: number; active_days: number }[]>`
    select count(*)::integer as sales,
      count(distinct (s.analytics_at at time zone 'Europe/Moscow')::date)::integer as active_days
    from public.canonical_analytics_sales s
    where s.analytics_included and s.sale_count_eligible and s.operation_type = 'sale'
      and s.analytics_at >= ${values[0]}::timestamptz and s.analytics_at < ${values[1]}::timestamptz
  `;
  const products = await sql<PlanningProduct[]>`select id::text, slug, name, is_active as active from public.products`;
  const recipes = await sql<PlanningRecipe[]>`select product_id::text as "productId", ingredient_id::text as "ingredientId",
    quantity::float8, unit from public.product_ingredients order by product_id, ingredient_id, id`;
  const options = await sql<PlanningOption[]>`select g.product_id::text as "productId", g.name as "groupName",
    o.modifier_type as "modifierType", o.ingredient_id::text as "ingredientId",
    o.replacement_ingredient_id::text as "replacementIngredientId", o.quantity_delta::float8 as quantity, o.unit
    from public.product_modifier_groups g left join public.product_modifier_options o on o.group_id = g.id`;
  const ingredients = await sql<PlanningIngredient[]>`
    select i.id::text, i.name, i.unit, i.waste_percent::float8 as "wastePercent",
      i.cost_per_unit::float8 as cost, i.package_size::float8 as "packageSize", i.is_active as active,
      case when stock.is_active then stock.current_quantity::float8 end as stock,
      coalesce(stock.reserved_quantity, 0)::float8 as reserved, coalesce(stock.min_quantity, 0)::float8 as minimum
    from public.ingredients i left join public.inventory_items stock on stock.ingredient_id = i.id and stock.unit = i.unit
  `;
  const summed = positions.reduce((sum, row) => ({ quantity: sum.quantity + row.quantity, revenue: sum.revenue + row.revenue }), { quantity: 0, revenue: 0 });
  if (Math.abs(summed.quantity - totals.quantity) > 1e-6 || Math.abs(summed.revenue - totals.revenue) > 0.005) {
    throw new Error("planning_canonical_totals_mismatch");
  }
  return { positions, products, recipes, options, ingredients, counts: counts[0], totals };
}

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
    await sql.unsafe("set local jit = off");
    return loadPlanningInputs(sql, from, today);
  });
  const futureWeekdays = Array.from({ length: 366 }, (_, index) => new Date(`${addCalendarDays(today, index)}T12:00:00Z`).getUTCDay());
  return { ...buildPurchasePlan({ ...result, sales: resolvePlanningSales(result), ...options,
      weekdaySamples: Array<number>(7).fill(options.history / 7), futureWeekdays }),
    from, through: addCalendarDays(today, -1), today, options,
    averageOrders: (result.counts?.sales ?? 0) / options.history, activeDays: result.counts?.active_days ?? 0 };
}
