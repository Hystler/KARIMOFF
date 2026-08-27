import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { channelLabels } from "./channels";
import { calculateMetricDelta, safeAverage } from "./metrics";
import { getAnalyticsConfiguration, getAnalyticsIntelligence } from "./intelligence";
import {
  averagePerAnalyticsDay,
  buildBucketKeys,
  formatBucketLabel,
  getAnalyticsGranularity,
  getComparisonRange
} from "./periods";
import { buildItemWhere, buildSalesWhere, buildScopeWhere, offsetPlaceholders } from "./query";
import type {
  AnalyticsBreakdownRow,
  AnalyticsChannel,
  AnalyticsDashboard,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AnalyticsGranularity,
  AnalyticsPaymentRow,
  AnalyticsPaymentOperations,
  AnalyticsFiscalOperations,
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
  receipts: string | number;
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

function hasItemFilters(filters: AnalyticsFilters) {
  return Boolean(filters.categories.length || filters.category || filters.product);
}

function itemFilteredWhere(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  const sales = buildSalesWhere(filters, range, scope, {
    alias: "s",
    includedOnly: true,
    includeItemFilters: false
  });
  const items = buildItemWhere(filters, { alias: "i", offset: sales.values.length });
  return {
    text: `${sales.text} and ${offsetPlaceholders(items.text, 0)}`,
    values: [...sales.values, ...items.values]
  };
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
  if (hasItemFilters(filters)) {
    const where = itemFilteredWhere(filters, range, scope);
    const rows = await query<MetricRow>(`
      select
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        count(distinct s.sale_id) filter (where s.sale_count_eligible and s.source = 'pos_evotor')::integer as receipts,
        coalesce(sum(i.quantity) filter (where s.sale_count_eligible and i.operation_type = 'sale'), 0)::numeric as items,
        coalesce(sum(i.refund_amount), 0)::numeric as refund_amount,
        count(distinct s.sale_id) filter (where i.refund_amount > 0)::integer as refund_count,
        coalesce(sum(i.discount_amount), 0)::numeric as discounts,
        count(distinct s.customer_id) filter (where s.sale_count_eligible and s.customer_id is not null)::integer as customers,
        coalesce(bool_or(s.customer_id is not null), false) as customers_available,
        coalesce(bool_or(s.discount_data_available), false) as discounts_available
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${where.text}
    `, where.values);
    return rows[0];
  }
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<MetricRow>(`
    select
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      count(*) filter (where s.sale_count_eligible and s.source = 'pos_evotor')::integer as receipts,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items,
      coalesce(sum(s.refund_amount), 0)::numeric as refund_amount,
      count(*) filter (where s.refund_amount > 0)::integer as refund_count,
      coalesce(sum(s.discount_amount), 0)::numeric as discounts,
      count(distinct s.customer_id) filter (where s.sale_count_eligible and s.customer_id is not null)::integer as customers,
      bool_or(s.customer_id is not null) as customers_available,
      bool_or(s.discount_data_available) as discounts_available
    from public.canonical_analytics_sales s
    where ${where.text}
  `, where.values);
  return rows[0] ?? {
    revenue: 0,
    sale_revenue: 0,
    sales: 0,
    receipts: 0,
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
  if (hasItemFilters(filters)) {
    const where = itemFilteredWhere(filters, range, scope);
    const bucket = bucketExpression(granularity);
    return query<TimelineRow>(`
      select
        ${bucket} as bucket,
        s.source,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        count(distinct s.sale_id) filter (where s.sale_count_eligible and s.source = 'pos_evotor')::integer as receipts,
        coalesce(sum(i.quantity) filter (where s.sale_count_eligible and i.operation_type = 'sale'), 0)::numeric as items,
        coalesce(sum(i.refund_amount), 0)::numeric as refund_amount,
        count(distinct s.sale_id) filter (where i.refund_amount > 0)::integer as refund_count,
        coalesce(sum(i.discount_amount), 0)::numeric as discounts,
        count(distinct s.customer_id) filter (where s.customer_id is not null)::integer as customers,
        coalesce(bool_or(s.customer_id is not null), false) as customers_available,
        coalesce(bool_or(s.discount_data_available), false) as discounts_available
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${where.text}
      group by 1, 2
      order by 1, 2
    `, where.values);
  }
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const bucket = bucketExpression(granularity);
  return query<TimelineRow>(`
    select
      ${bucket} as bucket,
      s.source,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      count(*) filter (where s.sale_count_eligible and s.source = 'pos_evotor')::integer as receipts,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items,
      coalesce(sum(s.refund_amount), 0)::numeric as refund_amount,
      count(*) filter (where s.refund_amount > 0)::integer as refund_count,
      coalesce(sum(s.discount_amount), 0)::numeric as discounts,
      count(distinct s.customer_id) filter (where s.customer_id is not null)::integer as customers,
      bool_or(s.customer_id is not null) as customers_available,
      bool_or(s.discount_data_available) as discounts_available
    from public.canonical_analytics_sales s
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
      receipts: bucketRows.reduce((sum, row) => sum + number(row.receipts), 0),
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
      payment_provider: string;
    }>(`
      select distinct source, location_id, location_name, terminal_id, terminal_name,
        employee_id, employee_name, payment_method, payment_provider
      from public.canonical_analytics_sales s
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
      join public.canonical_analytics_sales s on s.sale_id = i.sale_id
      where ${scopeWhere.text}
      order by i.product_name
    `, scopeWhere.values),
    query<{ has_previous_year: boolean }>(`
      select coalesce(min(s.analytics_at) <= now() - interval '1 year', false) as has_previous_year
      from public.canonical_analytics_sales s
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
    providers: unique(
      saleOptions.map((row) => ({ value: row.payment_provider, label: row.payment_provider }))
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
  receipts: string | number;
};

async function getProductRows(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope
) {
  const where = itemFilteredWhere(filters, range, scope);
  return query<ProductAggregate>(`
    select
      coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
      i.product_name,
      max(i.category) as category,
      case when bool_and(i.mapping_status in ('native', 'confirmed')) then 'mapped' else 'unmapped' end as mapping_status,
      count(distinct i.source)::integer as channel_count,
      min(i.source) as single_channel,
      coalesce(sum(i.net_quantity), 0)::numeric as quantity,
      coalesce(sum(i.net_revenue), 0)::numeric as revenue,
      count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
    from public.analytics_sale_items i
    join public.canonical_analytics_sales s on s.sale_id = i.sale_id
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
  const previousByKey = new Map(previous.map((row) => [row.product_key, {
    revenue: number(row.revenue),
    receipts: number(row.receipts)
  }]));
  const rows = current.map((row) => {
    const revenue = number(row.revenue);
    const quantity = number(row.quantity);
    const previousProduct = previousByKey.get(row.product_key);
    const previousRevenue = previousProduct?.revenue ?? 0;
    return {
      key: row.product_key,
      name: row.product_name,
      category: row.category,
      quantity,
      revenue,
      averagePrice: safeAverage(revenue, quantity),
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      previousRevenue,
      comparisonReceiptVolume: number(row.receipts) + (previousProduct?.receipts ?? 0),
      delta: calculateMetricDelta(revenue, previousRevenue),
      channel: number(row.channel_count) > 1 ? "multiple" as const : row.single_channel,
      mappingStatus: row.mapping_status === "mapped" ? "mapped" as const : "unmapped" as const
    };
  });
  const mode = filters.productRanking;
  const momentumMinimum = getAnalyticsConfiguration(filters, scope).momentumMinReceipts;
  const visibleRows = mode === "growth" || mode === "decline"
    ? rows.filter((row) => row.comparisonReceiptVolume >= momentumMinimum)
    : rows;
  visibleRows.sort((left, right) => {
    if (mode === "quantity") return right.quantity - left.quantity;
    if (mode === "growth") return (right.delta.percent ?? -Infinity) - (left.delta.percent ?? -Infinity);
    if (mode === "decline") return (left.delta.percent ?? Infinity) - (right.delta.percent ?? Infinity);
    return right.revenue - left.revenue;
  });
  return visibleRows.slice(0, 12);
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
  if (hasItemFilters(filters)) {
    const where = itemFilteredWhere(filters, range, scope);
    const columns = {
      location: { id: "s.location_id", name: "s.location_name", extra: "true" },
      terminal: { id: "s.terminal_id", name: "s.terminal_name", extra: "s.terminal_id is not null" },
      employee: { id: "s.employee_id", name: "s.employee_name", extra: "s.employee_id is not null" }
    }[field];
    return query<BreakdownAggregate>(`
      select ${columns.id} as id, coalesce(${columns.name}, 'Не указано') as name,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(i.refund_amount), 0)::numeric as refunds,
        coalesce(sum(i.quantity) filter (where s.sale_count_eligible and i.operation_type = 'sale'), 0)::numeric as items
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${where.text} and ${columns.extra}
      group by 1, 2
      order by revenue desc
    `, where.values);
  }
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
    from public.canonical_analytics_sales s
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
    const where = itemFilteredWhere(filters, selectedRange, scope);
    return query<BreakdownAggregate>(`
      select coalesce(i.category, '__unknown__') as id,
        coalesce(i.category, 'Категория не указана') as name,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(i.refund_amount), 0)::numeric as refunds,
        coalesce(sum(i.net_quantity), 0)::numeric as items
      from public.analytics_sale_items i
      join public.canonical_analytics_sales s on s.sale_id = i.sale_id
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
  scope: AnalyticsScope
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
      join public.canonical_analytics_sales s on s.sale_id = p.sale_id
      where ${where.text}
      group by 1, 2
      order by revenue desc
    `, where.values);
  };
  const [current, previous] = await Promise.all([load(range), load(comparisonRange)]);
  const paymentTotal = current.reduce((sum, row) => sum + number(row.revenue), 0);
  return mergeBreakdowns(current, previous, paymentTotal).map((row) => ({ ...row, method: row.id }));
}

type PaymentOperationsRow = {
  attempts: string | number;
  canceled: string | number;
  pending: string | number;
  succeeded: string | number;
  refund_amount: string | number;
  refunds: string | number;
  partial_refunds: string | number;
  average_pending_to_paid_seconds: string | number | null;
  average_paid_to_handed_out_seconds: string | number | null;
};

async function getPaymentOperations(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope
): Promise<AnalyticsPaymentOperations> {
  const where = buildSalesWhere(filters, range, scope, { alias: "s" });
  const rows = await query<PaymentOperationsRow>(`
    select
      count(distinct payment.id)::integer as attempts,
      count(distinct payment.id) filter (where payment.provider_status = 'succeeded')::integer as succeeded,
      count(distinct payment.id) filter (where payment.provider_status = 'canceled')::integer as canceled,
      count(distinct payment.id) filter (
        where coalesce(payment.provider_status, 'pending') in ('pending', 'waiting_for_capture')
      )::integer as pending,
      coalesce(sum(refund.completed_amount), 0)::numeric as refund_amount,
      coalesce(sum(refund.completed_count), 0)::integer as refunds,
      coalesce(sum(refund.partial_count), 0)::integer as partial_refunds,
      avg(extract(epoch from (payment.paid_at - coalesce(payment.provider_created_at, payment.created_at))))
        filter (where payment.paid_at is not null) as average_pending_to_paid_seconds,
      avg(extract(epoch from (order_row.handed_out_at - payment.paid_at)))
        filter (where payment.paid_at is not null and order_row.handed_out_at is not null)
        as average_paid_to_handed_out_seconds
    from public.canonical_analytics_sales s
    join public.payments payment
      on s.sale_id = 'web:' || payment.order_id::text
     and payment.provider = 'yookassa'
    join public.orders order_row on order_row.id = payment.order_id
    left join lateral (
      select
        coalesce(sum(amount) filter (where status = 'completed'), 0)::numeric as completed_amount,
        count(*) filter (where status = 'completed')::integer as completed_count,
        count(*) filter (
          where status = 'completed' and metadata ->> 'refund_kind' = 'partial'
        )::integer as partial_count
      from public.refunds
      where payment_id = payment.id and provider = 'yookassa'
    ) refund on true
    where ${where.text}
  `, where.values);
  const row = rows[0];
  const attempts = number(row?.attempts);
  const succeeded = number(row?.succeeded);
  return {
    attempts,
    canceled: number(row?.canceled),
    pending: number(row?.pending),
    succeeded,
    successRate: attempts > 0 ? (succeeded / attempts) * 100 : null,
    refundAmount: number(row?.refund_amount),
    refunds: number(row?.refunds),
    partialRefunds: number(row?.partial_refunds),
    averagePendingToPaidSeconds: row?.average_pending_to_paid_seconds === null
      ? null
      : number(row?.average_pending_to_paid_seconds),
    averagePaidToHandedOutSeconds: row?.average_paid_to_handed_out_seconds === null
      ? null
      : number(row?.average_paid_to_handed_out_seconds)
  };
}

type FiscalOperationsRow = {
  average_registration_seconds: string | number | null;
  closing_registered: string | number;
  errors: string | number;
  pending: string | number;
  prepayment_registered: string | number;
};

async function getFiscalOperations(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope
): Promise<AnalyticsFiscalOperations> {
  const where = buildSalesWhere(filters, range, scope, { alias: "s" });
  const rows = await query<FiscalOperationsRow>(`
    select
      count(*) filter (
        where receipt.receipt_phase = 'payment_prepayment' and receipt.status = 'issued'
      )::integer as prepayment_registered,
      count(*) filter (
        where receipt.receipt_phase = 'prepayment_settlement' and receipt.status = 'issued'
      )::integer as closing_registered,
      count(*) filter (where receipt.status in ('pending', 'processing'))::integer as pending,
      count(*) filter (where receipt.status = 'failed')::integer as errors,
      avg(extract(epoch from (receipt.fiscalized_at - receipt.created_at)))
        filter (where receipt.fiscalized_at is not null) as average_registration_seconds
    from public.canonical_analytics_sales s
    join public.fiscal_receipts receipt
      on s.sale_id = 'web:' || receipt.order_id::text
     and receipt.provider = 'yookassa'
    where ${where.text}
  `, where.values);
  const row = rows[0];
  return {
    prepaymentRegistered: number(row?.prepayment_registered),
    closingRegistered: number(row?.closing_registered),
    pending: number(row?.pending),
    errors: number(row?.errors),
    averageRegistrationSeconds: row?.average_registration_seconds === null
      ? null
      : number(row?.average_registration_seconds)
  };
}

async function getHeatmap(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  if (hasItemFilters(filters)) {
    const where = itemFilteredWhere(filters, range, scope);
    const rows = await query<{ weekday: string | number; hour: string | number; revenue: string | number; sales: string | number; items: string | number }>(`
      select
        extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
        extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(i.quantity) filter (where s.sale_count_eligible and i.operation_type = 'sale'), 0)::numeric as items
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${where.text}
      group by 1, 2
      order by 1, 2
    `, where.values);
    return rows.map((row) => ({
      weekday: number(row.weekday),
      hour: number(row.hour),
      revenue: number(row.revenue),
      sales: number(row.sales),
      items: number(row.items)
    }));
  }
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<{ weekday: string | number; hour: string | number; revenue: string | number; sales: string | number; items: string | number }>(`
    select
      extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
      extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales,
      coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items
    from public.canonical_analytics_sales s
    where ${where.text}
    group by 1, 2
    order by 1, 2
  `, where.values);
  return rows.map((row) => ({
    weekday: number(row.weekday),
    hour: number(row.hour),
    revenue: number(row.revenue),
    sales: number(row.sales),
    items: number(row.items)
  }));
}

async function getWeekdays(filters: AnalyticsFilters, range: AnalyticsRange, scope: AnalyticsScope) {
  if (hasItemFilters(filters)) {
    const where = itemFilteredWhere(filters, range, scope);
    const rows = await query<{ weekday: string | number; revenue: string | number; sale_revenue: string | number; sales: string | number }>(`
      select
        extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.gross_amount - i.discount_amount) filter (where i.operation_type = 'sale'), 0)::numeric as sale_revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as sales
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${where.text}
      group by 1
      order by 1
    `, where.values);
    return weekdayRows(rows);
  }
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includedOnly: true });
  const rows = await query<{ weekday: string | number; revenue: string | number; sale_revenue: string | number; sales: string | number }>(`
    select
      extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
      coalesce(sum(s.net_revenue), 0)::numeric as revenue,
      coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
      count(*) filter (where s.sale_count_eligible)::integer as sales
    from public.canonical_analytics_sales s
    where ${where.text}
    group by 1
    order by 1
  `, where.values);
  return weekdayRows(rows);
}

function weekdayRows(rows: Array<{ weekday: string | number; revenue: string | number; sale_revenue: string | number; sales: string | number }>) {
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
    from public.canonical_analytics_sales s
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
    receipts: number(currentMetric.receipts),
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
    receipts: number(previousMetric.receipts),
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
  const currentOrdersPerDay = averagePerAnalyticsDay(current.sales, range, filters.weekdays);
  const previousOrdersPerDay = averagePerAnalyticsDay(previous.sales, comparisonRange, filters.weekdays);
  const currentReceiptsPerDay = averagePerAnalyticsDay(current.receipts, range, filters.weekdays);
  const previousReceiptsPerDay = averagePerAnalyticsDay(previous.receipts, comparisonRange, filters.weekdays);
  const receiptSparkline = currentKeys.map((key) =>
    currentTimelineRows
      .filter((row) => row.bucket === key)
      .reduce((sum, row) => sum + number(row.receipts), 0)
  );

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

  const [products, categories, employees, locations, terminals, payments, paymentOperations, fiscalOperations] = await Promise.all([
    getProducts(filters, range, comparisonRange, scope, current.revenue),
    getCategories(filters, range, comparisonRange, scope, current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "employee", current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "location", current.revenue),
    getBreakdown(filters, range, comparisonRange, scope, "terminal", current.revenue),
    getPayments(filters, range, comparisonRange, scope),
    getPaymentOperations(filters, range, scope),
    getFiscalOperations(filters, range, scope)
  ]);
  const intelligence = await getAnalyticsIntelligence({
    filters,
    range,
    comparisonRange,
    scope,
    current: {
      revenue: current.revenue,
      sales: current.sales,
      items: current.items,
      saleRevenue: current.saleRevenue,
      refunds: current.refundAmount
    },
    previous: {
      revenue: previous.revenue,
      sales: previous.sales,
      items: previous.items,
      saleRevenue: previous.saleRevenue,
      refunds: previous.refundAmount
    }
  });

  return {
    filters,
    range,
    comparisonRange,
    granularity,
    kpis: {
      revenue: metricValue(current.revenue, previous.revenue, spark("revenue")),
      sales: metricValue(current.sales, previous.sales, spark("sales")),
      averageOrdersPerDay: metricValue(currentOrdersPerDay, previousOrdersPerDay, spark("sales")),
      averageReceiptsPerDay: metricValue(
        currentReceiptsPerDay,
        previousReceiptsPerDay,
        receiptSparkline
      ),
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
    paymentOperations,
    fiscalOperations,
    options,
    updatedAt,
    itemFiltered: hasItemFilters(filters),
    intelligence,
    error: null
  };
}
