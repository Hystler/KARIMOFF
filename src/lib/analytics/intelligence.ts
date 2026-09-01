import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getPostgresSql } from "@/lib/postgres/server";
import { analyticsFiltersToParams } from "./filters";
import { buildAverageTicketFactors, buildPareto, buildRevenueBridge, detectTransparentAnomaly } from "./intelligence-math";
import { calculateMetricDelta, safeAverage } from "./metrics";
import { OPERATING_HOURS, RESTAURANT_CLOSE_HOUR, RESTAURANT_OPEN_HOUR } from "./operating-hours";
import { addCalendarDays } from "./periods";
import { buildItemWhere, buildSalesWhere } from "./query";
import type {
  AnalyticsBasketPair,
  AnalyticsBasketSizeRow,
  AnalyticsCategoryCard,
  AnalyticsFilters,
  AnalyticsHourlyCategoryPoint,
  AnalyticsInsight,
  AnalyticsIntelligence,
  AnalyticsRange,
  AnalyticsScope,
  AnalyticsTreemapItem
} from "./types";

type Totals = { revenue: number; sales: number; items: number; saleRevenue: number; refunds: number };

const daypartDefinitions = [
  { key: "lunch", label: "Обед", start: 11, end: 14 },
  { key: "afternoon", label: "День", start: 14, end: 17 },
  { key: "evening", label: "Вечер", start: 17, end: 21 }
] as const;

const daypartSchema = z.array(z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  start: z.number().int().min(RESTAURANT_OPEN_HOUR).max(RESTAURANT_CLOSE_HOUR - 1),
  end: z.number().int().min(RESTAURANT_OPEN_HOUR + 1).max(RESTAURANT_CLOSE_HOUR)
}).refine((part) => part.end > part.start)).min(1).max(8);

const configurationSchema = z.object({
  dayparts: daypartSchema.optional(),
  abcA: z.number().positive().max(99).optional(),
  abcB: z.number().positive().max(99).optional(),
  momentumMinReceipts: z.number().int().min(1).max(1000).optional(),
  anomalySigma: z.number().min(1).max(6).optional()
}).refine((value) => (value.abcA ?? 80) < (value.abcB ?? 95));

const configurationMapSchema = z.record(z.string(), configurationSchema);

type AnalyticsConfiguration = {
  dayparts: Array<{ key: string; label: string; start: number; end: number }>;
  abcA: number;
  abcB: number;
  momentumMinReceipts: number;
  anomalySigma: number;
};

export function getAnalyticsConfiguration(filters: AnalyticsFilters, scope: AnalyticsScope): AnalyticsConfiguration {
  const fallback: AnalyticsConfiguration = {
    dayparts: daypartDefinitions.map((part) => ({ ...part })),
    abcA: 80,
    abcB: 95,
    momentumMinReceipts: 3,
    anomalySigma: 2
  };
  const locationId = filters.location ?? (scope.locationIds?.length === 1 ? scope.locationIds[0] : null);
  const raw = process.env.ANALYTICS_CONFIG_JSON;
  if (!raw) return fallback;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return fallback;
  }
  const parsed = configurationMapSchema.safeParse(decoded);
  if (!parsed.success) return fallback;
  const configured = (locationId ? parsed.data[locationId] : undefined) ?? parsed.data.default;
  if (!configured) return fallback;
  return {
    dayparts: configured.dayparts ?? fallback.dayparts,
    abcA: configured.abcA ?? fallback.abcA,
    abcB: configured.abcB ?? fallback.abcB,
    momentumMinReceipts: configured.momentumMinReceipts ?? fallback.momentumMinReceipts,
    anomalySigma: configured.anomalySigma ?? fallback.anomalySigma
  };
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function query<T>(text: string, values: unknown[] = []) {
  const sql = getPostgresSql();
  return sql.unsafe<T[]>(text, values as never[]);
}

function itemContext(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const sales = buildSalesWhere(filters, range, scope, {
    alias: "s",
    includedOnly: true,
    includeItemFilters: false
  });
  const items = buildItemWhere(filters, { alias: "i", offset: sales.values.length });
  return { text: `${sales.text} and ${items.text}`, values: [...sales.values, ...items.values] };
}

function saleContext(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  return buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
}

type CategoryAggregate = {
  id: string;
  name: string;
  revenue: string | number;
  quantity: string | number;
  receipts: string | number;
};

async function loadCategoryAggregates(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const context = itemContext(filters, range, scope);
  return query<CategoryAggregate>(`
    select
      coalesce(i.category, '__unknown__') as id,
      coalesce(i.category, 'Категория не указана') as name,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
      count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
    group by 1, 2
    order by revenue desc
  `, context.values);
}

async function loadCategoryTrend(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const context = itemContext(filters, range, scope);
  return query<{ id: string; day: string; revenue: string | number }>(`
    select coalesce(i.category, '__unknown__') as id,
      to_char(date_trunc('day', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD') as day,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
    group by 1, 2
    order by 2, 1
  `, context.values);
}

async function getCategoryCards(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  totalRevenue: number
): Promise<AnalyticsCategoryCard[]> {
  const [current, previous, trend] = await Promise.all([
    loadCategoryAggregates(filters, range, scope),
    loadCategoryAggregates(filters, comparisonRange, scope),
    loadCategoryTrend(filters, range, scope)
  ]);
  const previousById = new Map(previous.map((row) => [row.id, number(row.revenue)]));
  const trendById = new Map<string, number[]>();
  for (const row of trend) {
    const values = trendById.get(row.id) ?? [];
    values.push(number(row.revenue));
    trendById.set(row.id, values);
  }
  return current.map((row) => {
    const revenue = number(row.revenue);
    const quantity = number(row.quantity);
    const previousRevenue = previousById.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      revenue,
      quantity,
      receipts: number(row.receipts),
      averageItemPrice: safeAverage(revenue, quantity),
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      delta: calculateMetricDelta(revenue, previousRevenue),
      sparkline: trendById.get(row.id) ?? []
    };
  });
}

async function getHourlyDemand(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope,
  visibleCategories: string[]
): Promise<AnalyticsHourlyCategoryPoint[]> {
  const context = itemContext(filters, range, scope);
  const rows = await query<{
    category: string;
    hour: string | number;
    revenue: string | number;
    quantity: string | number;
    receipts: string | number;
  }>(`
    select coalesce(i.category, 'Категория не указана') as category,
      extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
      count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
      and extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer between 11 and 20
    group by 1, 2
    order by 2, 1
  `, context.values);
  return OPERATING_HOURS.map((hour) => {
    const categories: AnalyticsHourlyCategoryPoint["categories"] = {};
    for (const category of visibleCategories) {
      const row = rows.find((item) => item.category === category && number(item.hour) === hour);
      categories[category] = {
        revenue: number(row?.revenue),
        quantity: number(row?.quantity),
        receipts: number(row?.receipts)
      };
    }
    return { hour, categories };
  });
}

async function getCalendar(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const context = itemContext(filters, range, scope);
  const rows = await query<{
    date: string;
    revenue: string | number;
    sale_revenue: string | number;
    receipts: string | number;
  }>(`
    select to_char(date_trunc('day', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD') as date,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
      count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
    group by 1
    order by 1
  `, context.values);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const result = [];
  for (let date = range.fromDateKey; date < range.toDateKeyExclusive; date = addCalendarDays(date, 1)) {
    const row = byDate.get(date);
    const receipts = number(row?.receipts);
    result.push({
      date,
      revenue: number(row?.revenue),
      receipts,
      averageCheck: safeAverage(number(row?.sale_revenue), receipts)
    });
  }
  return result;
}

type ProductAggregate = {
  key: string;
  name: string;
  category: string;
  revenue: string | number;
  quantity: string | number;
  mapping_status: string;
};

async function getProductAggregates(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const context = itemContext(filters, range, scope);
  return query<ProductAggregate>(`
    select coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as key,
      i.product_name as name,
      coalesce(max(i.category), 'Категория не указана') as category,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
      case when bool_and(i.mapping_status in ('native', 'confirmed')) then 'mapped' else 'unmapped' end as mapping_status
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
    group by 1, 2
    order by revenue desc
  `, context.values);
}

function treemapFromProducts(rows: ProductAggregate[]): AnalyticsTreemapItem[] {
  const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, number(row.revenue)), 0);
  return rows.slice(0, 48).map((row) => ({
    key: row.key,
    name: row.name,
    category: row.category,
    revenue: number(row.revenue),
    quantity: number(row.quantity),
    share: positiveTotal > 0 ? (Math.max(0, number(row.revenue)) / positiveTotal) * 100 : 0,
    mappingStatus: row.mapping_status === "mapped" ? "mapped" : "unmapped"
  }));
}

async function getBasketPairs(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope): Promise<AnalyticsBasketPair[]> {
  const context = saleContext(filters, range, scope);
  const rows = await query<{
    left_key: string;
    left_name: string;
    right_key: string;
    right_name: string;
    baskets: string | number;
    total_baskets: string | number;
    left_baskets: string | number;
    right_baskets: string | number;
  }>(`
    with basket_items as (
      select distinct i.sale_id,
        coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
        i.product_name
      from public.analytics_sale_items i
      join public.canonical_analytics_sales s on s.sale_id = i.sale_id
      where ${context.text} and i.operation_type = 'sale' and i.quantity > 0
    ), product_baskets as (
      select product_key, count(distinct sale_id)::integer as baskets
      from basket_items group by product_key
    ), basket_total as (
      select count(distinct sale_id)::integer as baskets from basket_items
    )
    select left_item.product_key as left_key, min(left_item.product_name) as left_name,
      right_item.product_key as right_key, min(right_item.product_name) as right_name,
      count(distinct left_item.sale_id)::integer as baskets,
      max(basket_total.baskets)::integer as total_baskets,
      max(left_count.baskets)::integer as left_baskets,
      max(right_count.baskets)::integer as right_baskets
    from basket_items left_item
    join basket_items right_item
      on right_item.sale_id = left_item.sale_id and right_item.product_key > left_item.product_key
    join product_baskets left_count on left_count.product_key = left_item.product_key
    join product_baskets right_count on right_count.product_key = right_item.product_key
    cross join basket_total
    group by left_item.product_key, right_item.product_key
    having count(distinct left_item.sale_id) >= 2
    order by baskets desc, left_name, right_name
    limit 16
  `, context.values);
  return rows.map((row) => {
    const baskets = number(row.baskets);
    return {
      leftKey: row.left_key,
      leftName: row.left_name,
      rightKey: row.right_key,
      rightName: row.right_name,
      baskets,
      support: safeAverage(baskets, number(row.total_baskets)) * 100,
      confidence: Math.max(
        safeAverage(baskets, number(row.left_baskets)),
        safeAverage(baskets, number(row.right_baskets))
      ) * 100
    };
  });
}

async function getBasketSizes(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope): Promise<AnalyticsBasketSizeRow[]> {
  const context = saleContext(filters, range, scope);
  const rows = await query<{ bucket: string; receipts: string | number; revenue: string | number }>(`
    with basket_totals as (
      select s.sale_id, s.net_revenue,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as item_count
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${context.text} and s.sale_count_eligible
      group by s.sale_id, s.net_revenue
    )
    select case when item_count >= 4 then '4+' else greatest(1, floor(item_count)::integer)::text end as bucket,
      count(*)::integer as receipts,
      coalesce(sum(net_revenue), 0)::numeric as revenue
    from basket_totals
    group by 1
  `, context.values);
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return (["1", "2", "3", "4+"] as const).map((bucket) => {
    const row = byBucket.get(bucket);
    const receipts = number(row?.receipts);
    const revenue = number(row?.revenue);
    return { bucket, receipts, revenue, averageRevenue: safeAverage(revenue, receipts) };
  });
}

async function getHourlyTotals(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const context = itemContext(filters, range, scope);
  const rows = await query<{ hour: string | number; revenue: string | number; quantity: string | number; receipts: string | number }>(`
    select extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
      count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
    from public.canonical_analytics_sales s
    join public.analytics_sale_items i on i.sale_id = s.sale_id
    where ${context.text}
      and extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer between 11 and 20
    group by 1 order by 1
  `, context.values);
  return OPERATING_HOURS.map((hour) => {
    const row = rows.find((item) => number(item.hour) === hour);
    return { hour, revenue: number(row?.revenue), quantity: number(row?.quantity), receipts: number(row?.receipts) };
  });
}

function buildDayparts(
  hourly: Array<{ hour: number; revenue: number; quantity: number; receipts: number }>,
  definitions: AnalyticsConfiguration["dayparts"]
) {
  return definitions.map((part) => {
    const rows = hourly.filter((row) => row.hour >= part.start && row.hour < part.end);
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const receipts = rows.reduce((sum, row) => sum + row.receipts, 0);
    return {
      key: part.key,
      label: part.label,
      hours: `${String(part.start).padStart(2, "0")}:00–${String(part.end).padStart(2, "0")}:00`,
      revenue,
      receipts,
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      averageCheck: safeAverage(revenue, receipts)
    };
  });
}

async function getProductProfile(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  products: ProductAggregate[],
  hourly: Array<{ hour: number; revenue: number; quantity: number; receipts: number }>
) {
  if (!filters.product) return null;
  const product = products.find((row) => row.key === filters.product);
  if (!product) return null;
  const categoryName = product.category === "Категория не указана" ? null : product.category;
  const categoryFilters: AnalyticsFilters = {
    ...filters,
    product: null,
    categories: categoryName ? [categoryName] : [],
    category: categoryName
  };
  const [previousProducts, distribution, categoryTotals] = await Promise.all([
    getProductAggregates(filters, comparisonRange, scope),
    (() => {
      const context = itemContext(filters, range, scope);
      return query<{ days_sold: string | number; weekday: string | number; quantity: string | number }>(`
        select count(distinct (s.analytics_at at time zone 'Europe/Moscow')::date)::integer as days_sold,
          extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
          coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity
        from public.canonical_analytics_sales s
        join public.analytics_sale_items i on i.sale_id = s.sale_id
        where ${context.text}
        group by 2 order by 2
      `, context.values);
    })(),
    categoryName
      ? (() => {
          const context = itemContext(categoryFilters, range, scope);
          return query<{ revenue: string | number }>(`
            select coalesce(sum(i.net_revenue), 0)::numeric as revenue
            from public.canonical_analytics_sales s
            join public.analytics_sale_items i on i.sale_id = s.sale_id
            where ${context.text}
          `, context.values);
        })()
      : Promise.resolve([])
  ]);
  const revenue = number(product.revenue);
  const quantity = number(product.quantity);
  const previousRevenue = number(previousProducts.find((row) => row.key === product.key)?.revenue);
  const activeWeekdays = distribution.filter((row) => number(row.quantity) > 0);
  const strongest = [...activeWeekdays].sort((left, right) => number(right.quantity) - number(left.quantity))[0];
  const weakest = [...activeWeekdays].sort((left, right) => number(left.quantity) - number(right.quantity))[0];
  const peak = [...hourly].filter((row) => row.quantity > 0).sort((left, right) => right.quantity - left.quantity)[0];
  const daysSold = distribution.reduce((sum, row) => sum + number(row.days_sold), 0);
  return {
    key: product.key,
    name: product.name,
    category: categoryName,
    revenue,
    quantity,
    daysSold,
    averageUnitsPerDay: safeAverage(quantity, daysSold),
    peakHour: peak?.hour ?? null,
    strongestWeekday: strongest ? number(strongest.weekday) : null,
    weakestWeekday: weakest ? number(weakest.weekday) : null,
    categoryShare: categoryName && number(categoryTotals[0]?.revenue) > 0
      ? (revenue / number(categoryTotals[0]?.revenue)) * 100
      : null,
    delta: calculateMetricDelta(revenue, previousRevenue)
  };
}

function insightHref(filters: AnalyticsFilters, patch: Record<string, string>) {
  const params = analyticsFiltersToParams(filters);
  for (const [key, value] of Object.entries(patch)) params.set(key, value);
  return `/admin/analytics?${params.toString()}`;
}

function buildInsights(params: {
  filters: AnalyticsFilters;
  categoryCards: AnalyticsCategoryCard[];
  peakHours: Array<{ hour: number; revenue: number; quantity: number; receipts: number }>;
  current: Totals;
  previous: Totals;
  calendar: Array<{ date: string; revenue: number }>;
  momentumMinReceipts: number;
  anomalySigma: number;
}): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  const category = params.categoryCards
    .filter((row) => row.id !== "__unknown__" && row.receipts >= params.momentumMinReceipts && row.delta.percent !== null)
    .sort((left, right) => Math.abs(right.delta.percent ?? 0) - Math.abs(left.delta.percent ?? 0))[0];
  if (category) {
    const change = category.delta.percent ?? 0;
    insights.push({
      id: `category-${category.id}`,
      tone: change > 0 ? "positive" : change < 0 ? "negative" : "neutral",
      title: `${category.name}: ${change > 0 ? "+" : ""}${Math.round(change)}%`,
      detail: `Выручка к сопоставимому периоду · ${category.receipts} чеков в текущей выборке`,
      href: insightHref(params.filters, { category: category.id })
    });
  }
  const peak = params.peakHours[0];
  if (peak) {
    insights.push({
      id: "peak-hour",
      tone: "neutral",
      title: `Пик спроса: ${String(peak.hour).padStart(2, "0")}:00–${String(peak.hour + 1).padStart(2, "0")}:00`,
      detail: `${peak.receipts} чеков и ${Math.round(peak.quantity * 100) / 100} проданных позиций`,
      href: insightHref(params.filters, { hourFrom: String(peak.hour), hourTo: String(peak.hour + 1) })
    });
  }
  const currentTicket = safeAverage(params.current.saleRevenue, params.current.sales);
  const previousTicket = safeAverage(params.previous.saleRevenue, params.previous.sales);
  const ticketDelta = calculateMetricDelta(currentTicket, previousTicket);
  if (ticketDelta.absolute !== 0 && ticketDelta.percent !== null) {
    insights.push({
      id: "average-ticket",
      tone: ticketDelta.absolute > 0 ? "positive" : "negative",
      title: `Средний чек ${ticketDelta.absolute > 0 ? "выше" : "ниже"} на ${Math.abs(Math.round(ticketDelta.absolute))} ₽`,
      detail: "Арифметическое сравнение с выбранным предыдущим периодом",
      href: insightHref(params.filters, { metric: "average_check" })
    });
  }
  const sortedDays = [...params.calendar].sort((left, right) => left.date.localeCompare(right.date));
  const latest = sortedDays.at(-1);
  const latestWeekday = latest ? new Date(`${latest.date}T12:00:00Z`).getUTCDay() : null;
  const baseline = latest
    ? sortedDays
        .slice(0, -1)
        .filter((row) => new Date(`${row.date}T12:00:00Z`).getUTCDay() === latestWeekday)
        .slice(-8)
        .map((row) => row.revenue)
    : [];
  const anomaly = latest ? detectTransparentAnomaly(latest.revenue, baseline, params.anomalySigma) : null;
  if (latest && anomaly) {
    insights.push({
      id: "transparent-anomaly",
      tone: anomaly.score > 0 ? "positive" : "negative",
      title: anomaly.score > 0 ? "Необычно высокий день" : "Необычно низкий день",
      detail: `Отклонение более чем на ${params.anomalySigma}σ от среднего того же дня недели`,
      href: `/admin/analytics?period=custom&from=${latest.date}&to=${latest.date}`
    });
  }
  return insights.slice(0, 4);
}

type IntelligenceParams = {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  comparisonRange: AnalyticsRange;
  scope: AnalyticsScope;
  current: Totals;
  previous: Totals;
};

async function loadAnalyticsIntelligence(params: IntelligenceParams): Promise<AnalyticsIntelligence> {
  const { filters, range, comparisonRange, scope, current, previous } = params;
  const [categoryCards, calendar, products, basketPairs, basketSizes, hourly, syncRows, configuration] = await Promise.all([
    getCategoryCards(filters, range, comparisonRange, scope, current.revenue),
    getCalendar(filters, range, scope),
    getProductAggregates(filters, range, scope),
    getBasketPairs(filters, range, scope),
    getBasketSizes(filters, range, scope),
    getHourlyTotals(filters, range, scope),
    query<{ finished_at: string | null }>(`
      select max(finished_at)::text as finished_at
      from public.evotor_sync_events
      where status = 'success'
    `),
    getAnalyticsConfiguration(filters, scope)
  ]);
  const visibleCategories = (filters.categories.length
    ? filters.categories
    : categoryCards.filter((row) => row.id !== "__unknown__").slice(0, 5).map((row) => row.name));
  const hourlyDemand = await getHourlyDemand(filters, range, scope, visibleCategories);
  const treemap = treemapFromProducts(products);
  const pareto = buildPareto(products.map((row) => ({
    key: row.key,
    name: row.name,
    revenue: number(row.revenue),
    quantity: number(row.quantity)
  })), { a: configuration.abcA, b: configuration.abcB });
  const peakHours = [...hourly]
    .filter((row) => row.revenue !== 0 || row.quantity !== 0 || row.receipts !== 0)
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 3);
  const lastEvotorSyncAt = syncRows[0]?.finished_at ?? null;
  return {
    categoryCards,
    hourlyDemand,
    calendar,
    treemap,
    pareto,
    basketPairs,
    basketSizes,
    dayparts: buildDayparts(hourly, configuration.dayparts),
    peakHours,
    averageTicketFactors: buildAverageTicketFactors(current, previous),
    revenueBridge: buildRevenueBridge(current, previous),
    insights: buildInsights({
      filters,
      categoryCards,
      peakHours,
      current,
      previous,
      calendar,
      momentumMinReceipts: configuration.momentumMinReceipts,
      anomalySigma: configuration.anomalySigma
    }),
    productProfile: await getProductProfile(filters, range, comparisonRange, scope, products, hourly),
    lastEvotorSyncAt,
    stale: Boolean(lastEvotorSyncAt && Date.now() - new Date(lastEvotorSyncAt).getTime() > 10 * 60_000)
  };
}

const getCurrentIntelligence = unstable_cache(
  loadAnalyticsIntelligence,
  ["karimoff-premium-analytics-current-v1"],
  { revalidate: 30, tags: ["karimoff-analytics"] }
);

const getHistoricalIntelligence = unstable_cache(
  loadAnalyticsIntelligence,
  ["karimoff-premium-analytics-history-v1"],
  { revalidate: 300, tags: ["karimoff-analytics"] }
);

export function getAnalyticsIntelligence(params: IntelligenceParams) {
  const includesCurrentBusinessDay = params.range.to.getTime() > Date.now();
  return includesCurrentBusinessDay ? getCurrentIntelligence(params) : getHistoricalIntelligence(params);
}
