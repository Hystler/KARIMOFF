import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { channelLabels } from "./channels";
import { calculateMetricDelta, safeAverage } from "./metrics";
import {
  buildBucketKeys,
  formatBucketLabel,
  getAnalyticsGranularity,
  getComparisonRange
} from "./periods";
import { buildSalesWhere, buildScopeWhere } from "./query";
import type {
  AnalyticsBreakdownRow,
  AnalyticsChannel,
  AnalyticsDashboard,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AnalyticsGranularity,
  AnalyticsPaymentRow,
  AnalyticsProductRow,
  AnalyticsRange,
  AnalyticsScope,
  KpiValue,
  TimeSeriesPoint
} from "./types";

type MetricRow = {
  revenue: string | number;
  sale_revenue: string | number;
  sales: string | number;
  items: string | number;
  refund_amount: string | number;
  refund_count: string | number;
  discounts: string | number;
  customers: string | number;
  customers_available: boolean;
  discounts_available: boolean;
};

type TimelineRow = MetricRow & { bucket: string; source: AnalyticsChannel };

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricValue(current: number, previous: number, sparkline: number[]): KpiValue {
  return { current, previous, delta: calculateMetricDelta(current, previous), sparkline };
}

async function query<T>(text: string, values: unknown[] = []) {
  const sql = getPostgresSql();
  return sql.unsafe<T[]>(text, values as never[]);
}

async function getMetricRow(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope
) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<MetricRow>(`
    select
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items,
      coalesce(sum(s.refund_amount), 0)::numeric as refund_amount,
      count(*) filter (where s.refund_amount > 0)::integer as refund_count,
      coalesce(sum(s.discount_amount), 0)::numeric as discounts,
      count(distinct s.customer_id) filter (where s.sale_count_eligible and s.customer_id is not null)::integer as customers,
      bool_or(s.customer_id is not null) as customers_available,
      bool_or(s.discount_data_available) as discounts_available
    from public.analytics_sales s
    where ${where.text}
  `, where.values);
  return rows[0] ?? {
    revenue: 0,
    sale_revenue: 0,
    sales: 0,
    items: 0,
    refund_amount: 0,
    refund_count: 0,
    discounts: 0,
    customers: 0,
    customers_available: false,
    discounts_available: false
  };
}

function bucketExpression(granularity: AnalyticsGranularity) {
  if (granularity === "hour") {
    return `to_char(date_trunc('hour', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD"T"HH24')`;
  }
  if (granularity === "day") {
    return `to_char(date_trunc('day', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`;
  }
  if (granularity === "week") {
    return `to_char(date_trunc('week', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`;
  }
  return `to_char(date_trunc('month', s.analytics_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`;
}

async function getTimelineRows(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope,
  granularity: AnalyticsGranularity
) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const bucket = bucketExpression(granularity);
  return query<TimelineRow>(`
    select
      ${bucket} as bucket,
      s.source,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items,
      coalesce(sum(s.refund_amount), 0)::numeric as refund_amount,
      count(*) filter (where s.refund_amount > 0)::integer as refund_count,
      coalesce(sum(s.discount_amount), 0)::numeric as discounts,
      count(distinct s.customer_id) filter (where s.customer_id is not null)::integer as customers,
      bool_or(s.customer_id is not null) as customers_available,
      bool_or(s.discount_data_available) as discounts_available
    from public.analytics_sales s
    where ${where.text}
    group by 1, 2
    order by 1, 2
  `, where.values);
}

function valueForMetric(row: Partial<TimelineRow> | undefined, metric: AnalyticsFilters["metric"]) {
  if (!row) return 0;
  if (metric === "sales") return number(row.sales);
  if (metric === "items") return number(row.items);
  if (metric === "refunds") return number(row.refund_amount);
  if (metric === "average_check") return safeAverage(number(row.sale_revenue), number(row.sales));
  return number(row.revenue);
}

function mergeTimelineRows(
  rows: TimelineRow[],
  keys: string[],
  granularity: AnalyticsGranularity,
  metric: AnalyticsFilters["metric"]
) {
  const byBucket = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const current = byBucket.get(row.bucket) ?? [];
    current.push(row);
    byBucket.set(row.bucket, current);
  }
  return keys.map((key) => {
    const bucketRows = byBucket.get(key) ?? [];
    const aggregate: Partial<TimelineRow> = {
      revenue: bucketRows.reduce((sum, row) => sum + number(row.revenue), 0),
      sale_revenue: bucketRows.reduce((sum, row) => sum + number(row.sale_revenue), 0),
      sales: bucketRows.reduce((sum, row) => sum + number(row.sales), 0),
      items: bucketRows.reduce((sum, row) => sum + number(row.items), 0),
      refund_amount: bucketRows.reduce((sum, row) => sum + number(row.refund_amount), 0)
    };
    const channels: Partial<Record<AnalyticsChannel, number>> = {};
    for (const row of bucketRows) channels[row.source] = valueForMetric(row, metric);
    return {
      key,
      label: formatBucketLabel(key, granularity),
      value: valueForMetric(aggregate, metric),
      channels
    };
  });
}

export async function getAnalyticsFilterOptions(scope: AnalyticsScope): Promise<AnalyticsFilterOptions> {
  const scopeWhere = buildScopeWhere(scope, "s");
  const [saleOptions, itemOptions, history] = await Promise.all([
    query<{
      source: AnalyticsChannel;
      location_id: string;
      location_name: string;
      terminal_id: string | null;
      terminal_name: string | null;
      employee_id: string | null;
      employee_name: string | null;
      payment_method: string;
    }>(`
      select distinct source, location_id, location_name, terminal_id, terminal_name,
        employee_id, employee_name, payment_method
      from public.analytics_sales s
      where ${scopeWhere.text}
    `, scopeWhere.values),
    query<{
      product_key: string;
      product_name: string;
      category: string | null;
    }>(`
      select distinct
        coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
        i.product_name,
        i.category
      from public.analytics_sale_items i
      join public.analytics_sales s on s.sale_id = i.sale_id
      where ${scopeWhere.text}
      order by i.product_name
    `, scopeWhere.values),
    query<{ has_previous_year: boolean }>(`
      select coalesce(min(s.analytics_at) <= now() - interval '1 year', false) as has_previous_year
      from public.analytics_sales s
      where ${scopeWhere.text}
    `, scopeWhere.values)
  ]);

  const unique = (items: Array<{ value: string | null; label: string | null }>) =>
    Array.from(
      new Map(
        items
          .filter((item): item is { value: string; label: string } => Boolean(item.value && item.label))
          .map((item) => [item.value, item])
      ).values()
    ).sort((left, right) => left.label.localeCompare(right.label, "ru"));

  return {
    hasPreviousYear: Boolean(history[0]?.has_previous_year),
    channels: unique(
      saleOptions.map((row) => ({ value: row.source, label: channelLabels[row.source] ?? row.source }))
    ),
    locations: unique(saleOptions.map((row) => ({ value: row.location_id, label: row.location_name }))),
    terminals: unique(saleOptions.map((row) => ({ value: row.terminal_id, label: row.terminal_name }))),
    employees: unique(saleOptions.map((row) => ({ value: row.employee_id, label: row.employee_name }))),
    payments: unique(
      saleOptions.map((row) => ({ value: row.payment_method, label: row.payment_method }))
    ),
    categories: unique(
      itemOptions.map((row) => ({ value: row.category, label: row.category }))
    ),
    products: unique(
      itemOptions.map((row) => ({ value: row.product_key, label: row.product_name }))
    )
  };
}

type ProductAggregate = {
  product_key: string;
  product_name: string;
  category: string | null;
  mapping_status: string;
  channel_count: string | number;
  single_channel: AnalyticsChannel;
  quantity: string | number;
  revenue: string | number;
};

async function getProductRows(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope
) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  return query<ProductAggregate>(`
    select
      coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
      i.product_name,
      max(i.category) as category,
      case when bool_and(i.mapping_status in ('native', 'confirmed')) then 'mapped' else 'unmapped' end as mapping_status,
      count(distinct i.source)::integer as channel_count,
      min(i.source) as single_channel,
      coalesce(sum(i.net_quantity), 0)::numeric as quantity,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue
    from public.analytics_sale_items i
    join public.analytics_sales s on s.sale_id = i.sale_id
    where ${where.text}
    group by 1, 2
  `, where.values);
}

async function getProducts(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  totalRevenue: number
): Promise<AnalyticsProductRow[]> {
  const [current, previous] = await Promise.all([
    getProductRows(filters, range, scope),
    getProductRows(filters, comparisonRange, scope)
  ]);
  const previousByKey = new Map(previous.map((row) => [row.product_key, number(row.revenue)]));
  const rows = current.map((row) => {
    const revenue = number(row.revenue);
    const quantity = number(row.quantity);
    const previousRevenue = previousByKey.get(row.product_key) ?? 0;
    return {
      key: row.product_key,
      name: row.product_name,
      category: row.category,
      quantity,
      revenue,
      averagePrice: safeAverage(revenue, quantity),
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      previousRevenue,
      delta: calculateMetricDelta(revenue, previousRevenue),
      channel: number(row.channel_count) > 1 ? "multiple" as const : row.single_channel,
      mappingStatus: row.mapping_status === "mapped" ? "mapped" as const : "unmapped" as const
    };
  });
  const mode = filters.productRanking;
  rows.sort((left, right) => {
    if (mode === "quantity") return right.quantity - left.quantity;
    if (mode === "growth") return (right.delta.percent ?? -Infinity) - (left.delta.percent ?? -Infinity);
    if (mode === "decline") return (left.delta.percent ?? Infinity) - (right.delta.percent ?? Infinity);
    return right.revenue - left.revenue;
  });
  return rows.slice(0, 12);
}

type BreakdownAggregate = {
  id: string;
  name: string;
  revenue: string | number;
  sale_revenue: string | number;
  sales: string | number;
  refunds: string | number;
  items: string | number;
};

async function getSaleBreakdownRows(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope,
  field: "location" | "terminal" | "employee"
) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const columns = {
    location: { id: "s.location_id", name: "s.location_name", extra: "true" },
    terminal: { id: "s.terminal_id", name: "s.terminal_name", extra: "s.terminal_id is not null" },
    employee: { id: "s.employee_id", name: "s.employee_name", extra: "s.employee_id is not null" }
  }[field];
  return query<BreakdownAggregate>(`
    select ${columns.id} as id, coalesce(${columns.name}, 'Не указано') as name,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      coalesce(sum(s.refund_amount), 0)::numeric as refunds,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items
    from public.analytics_sales s
    where ${where.text} and ${columns.extra}
    group by 1, 2
    order by revenue desc
  `, where.values);
}

function mergeBreakdowns(
  current: BreakdownAggregate[],
  previous: BreakdownAggregate[],
  totalRevenue: number
): AnalyticsBreakdownRow[] {
  const previousById = new Map(previous.map((row) => [row.id, number(row.revenue)]));
  return current.map((row) => {
    const revenue = number(row.revenue);
    const sales = number(row.sales);
    const previousRevenue = previousById.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      revenue,
      sales,
      averageCheck: safeAverage(number(row.sale_revenue), sales),
      refunds: number(row.refunds),
      itemsPerCheck: safeAverage(number(row.items), sales),
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      delta: calculateMetricDelta(revenue, previousRevenue)
    };
  });
}

async function getBreakdown(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  field: "location" | "terminal" | "employee",
  totalRevenue: number
) {
  const [current, previous] = await Promise.all([
    getSaleBreakdownRows(filters, range, scope, field),
    getSaleBreakdownRows(filters, comparisonRange, scope, field)
  ]);
  return mergeBreakdowns(current, previous, totalRevenue);
}

async function getCategories(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  totalRevenue: number
) {
  const load = async (selectedRange: AnalyticsRange) => {
    const where = buildSalesWhere(filters, selectedRange, scope, { alias: "s", includedOnly: true });
    return query<BreakdownAggregate>(`
      select coalesce(i.category, '__unknown__') as id,
        coalesce(i.category, 'Категория не указана') as name,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(i.refund_amount), 0)::numeric as refunds,
        coalesce(sum(i.net_quantity), 0)::numeric as items
      from public.analytics_sale_items i
      join public.analytics_sales s on s.sale_id = i.sale_id
      where ${where.text}
      group by 1, 2
      order by revenue desc
    `, where.values);
  };
  const [current, previous] = await Promise.all([load(range), load(comparisonRange)]);
  return mergeBreakdowns(current, previous, totalRevenue);
}

async function getPayments(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  comparisonRange: AnalyticsRange,
  scope: AnalyticsScope,
  totalRevenue: number
): Promise<AnalyticsPaymentRow[]> {
  const load = async (selectedRange: AnalyticsRange) => {
    const where = buildSalesWhere(filters, selectedRange, scope, { alias: "s", includedOnly: true });
    return query<BreakdownAggregate>(`
      select p.payment_method as id, p.payment_method as name,
        coalesce(sum(p.amount), 0)::numeric as revenue,
        coalesce(sum(p.amount) filter (where s.sale_count_eligible and p.amount > 0), 0)::numeric as sale_revenue,
        count(distinct p.sale_id) filter (where s.sale_count_eligible and p.amount > 0)::integer as sales,
        coalesce(sum(abs(p.amount)) filter (where p.amount < 0), 0)::numeric as refunds,
        0::numeric as items
      from public.analytics_sale_payments p
      join public.analytics_sales s on s.sale_id = p.sale_id
      where ${where.text}
      group by 1, 2
      order by revenue desc
    `, where.values);
  };
  const [current, previous] = await Promise.all([load(range), load(comparisonRange)]);
  return mergeBreakdowns(current, previous, totalRevenue).map((row) => ({ ...row, method: row.id }));
}

async function getHeatmap(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<{ weekday: string | number; hour: string | number; revenue: string | number; sales: string | number }>(`
    select
      extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
      extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales
    from public.analytics_sales s
    where ${where.text}
    group by 1, 2
    order by 1, 2
  `, where.values);
  return rows.map((row) => ({
    weekday: number(row.weekday),
    hour: number(row.hour),
    revenue: number(row.revenue),
    sales: number(row.sales)
  }));
}

async function getWeekdays(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<{ weekday: string | number; revenue: string | number; sale_revenue: string | number; sales: string | number }>(`
    select
      extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales
    from public.analytics_sales s
    where ${where.text}
    group by 1
    order by 1
  `, where.values);
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const row = rows.find((item) => number(item.weekday) === weekday);
    const sales = number(row?.sales);
    return {
      weekday,
      revenue: number(row?.revenue),
      sales,
      averageCheck: safeAverage(number(row?.sale_revenue), sales)
    };
  });
}

async function getUpdatedAt(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const where = buildSalesWhere(filters, range, scope, { alias: "s" });
  const rows = await query<{ updated_at: string | null }>(`
    select max(s.source_updated_at)::text as updated_at
    from public.analytics_sales s
    where ${where.text}
  `, where.values);
  return rows[0]?.updated_at ?? null;
}

export async function getAnalyticsDashboard(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
}): Promise<AnalyticsDashboard> {
  const { filters, range, scope } = params;
  const comparisonRange = getComparisonRange(range, filters.comparison);
  const granularity = getAnalyticsGranularity(range);

  const [currentMetric, previousMetric, currentTimelineRows, previousTimelineRows, options, heatmap, weekdays, updatedAt] =
    await Promise.all([
      getMetricRow(filters, range, scope),
      getMetricRow(filters, comparisonRange, scope),
      getTimelineRows(filters, range, scope, granularity),
      getTimelineRows(filters, comparisonRange, scope, granularity),
      getAnalyticsFilterOptions(scope),
      getHeatmap(filters, range, scope),
      getWeekdays(filters, range, scope),
      getUpdatedAt(filters, range, scope)
    ]);

  const currentKeys = buildBucketKeys(range, granularity);
  const previousKeys = buildBucketKeys(comparisonRange, granularity);
  const currentTimeline = mergeTimelineRows(currentTimelineRows, currentKeys, granularity, filters.metric);
  const previousTimeline = mergeTimelineRows(previousTimelineRows, previousKeys, granularity, filters.metric);
  const timeline: TimeSeriesPoint[] = currentTimeline.map((point, index) => ({
    ...point,
    previousValue: previousTimeline[index]?.value ?? null
  }));

  const current = {
    revenue: number(currentMetric.revenue),
    saleRevenue: number(currentMetric.sale_revenue),
    sales: number(currentMetric.sales),
    items: number(currentMetric.items),
    refundAmount: number(currentMetric.refund_amount),
    refundCount: number(currentMetric.refund_count),
    discounts: number(currentMetric.discounts),
    customers: number(currentMetric.customers)
  };
  const previous = {
    revenue: number(previousMetric.revenue),
    saleRevenue: number(previousMetric.sale_revenue),
    sales: number(previousMetric.sales),
    items: number(previousMetric.items),
    refundAmount: number(previousMetric.refund_amount),
    refundCount: number(previousMetric.refund_count),
    discounts: number(previousMetric.discounts),
    customers: number(previousMetric.customers)
  };
  const spark = (metric: AnalyticsFilters["metric"]) =>
    mergeTimelineRows(currentTimelineRows, currentKeys, granularity, metric).map((point) => point.value);
  const currentAverage = safeAverage(current.saleRevenue, current.sales);
  const previousAverage = safeAverage(previous.saleRevenue, previous.sales);

  const revenueMix = options.channels
    .map((option) => {
      const channel = option.value as AnalyticsChannel;
      const rows = currentTimelineRows.filter((row) => row.source === channel);
      const revenue = rows.reduce((sum, row) => sum + number(row.revenue), 0);
      const sales = rows.reduce((sum, row) => sum + number(row.sales), 0);
      return {
        channel,
        revenue,
        sales,
        share: current.revenue > 0 ? (revenue / current.revenue) * 100 : 0
      };
    })
    .filter((row) => row.revenue !== 0 || row.sales !== 0);

  const [products, categories, employees, locations, terminals, payments] = await Promise.all([
    getProducts(filters, range, comparisonRange, scope, current.revenue),
    getCategories(filters, range, comparisonRange, scope, current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "employee", current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "location", current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "terminal", current.revenue),
    getPayments(filters, range, comparisonRange, scope, current.revenue)
  ]);

  return {
    filters,
    range,
    comparisonRange,
    granularity,
    kpis: {
      revenue: metricValue(current.revenue, previous.revenue, spark("revenue")),
      sales: metricValue(current.sales, previous.sales, spark("sales")),
      averageCheck: metricValue(currentAverage, previousAverage, spark("average_check")),
      items: metricValue(current.items, previous.items, spark("items")),
      refunds: metricValue(current.refundAmount, previous.refundAmount, spark("refunds")),
      refundCount: metricValue(current.refundCount, previous.refundCount, [previous.refundCount, current.refundCount]),
      discounts: metricValue(current.discounts, previous.discounts, [previous.discounts, current.discounts]),
      customers: metricValue(current.customers, previous.customers, [previous.customers, current.customers]),
      customersAvailable: Boolean(currentMetric.customers_available),
      discountsAvailable: Boolean(currentMetric.discounts_available)
    },
    timeline,
    revenueMix,
    heatmap,
    weekdays,
    products,
    categories,
    employees,
    locations,
    terminals,
    payments,
    options,
    updatedAt,
    error: null
  };
}
