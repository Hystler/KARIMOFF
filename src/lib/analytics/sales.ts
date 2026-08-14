import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { getAnalyticsFilterOptions } from "./dashboard";
import { buildSalesWhere } from "./query";
import type {
  AnalyticsFilters,
  AnalyticsRange,
  AnalyticsSaleDetail,
  AnalyticsSaleItem,
  AnalyticsSalePayment,
  AnalyticsSaleRow,
  AnalyticsSalesPage,
  AnalyticsScope
} from "./types";

type SaleDatabaseRow = {
  sale_id: string;
  external_source_id: string;
  source: AnalyticsSaleRow["channel"];
  source_subtype: string;
  order_number: string;
  analytics_at: string;
  status: string;
  operation_type: string;
  location_name: string;
  terminal_name: string | null;
  employee_name: string | null;
  customer_name: string | null;
  items_count: string | number;
  gross_amount: string | number;
  discount_amount: string | number;
  refund_amount: string | number;
  net_revenue: string | number;
  payment_method: string;
  currency: string;
  analytics_included: boolean;
  source_record_id?: string;
  source_updated_at?: string | null;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSale(row: SaleDatabaseRow): AnalyticsSaleRow {
  return {
    saleId: row.sale_id,
    externalSourceId: row.external_source_id,
    channel: row.source,
    sourceSubtype: row.source_subtype,
    number: row.order_number,
    analyticsAt: row.analytics_at,
    status: row.status,
    operationType: row.operation_type,
    location: row.location_name,
    terminal: row.terminal_name,
    employee: row.employee_name,
    customer: row.customer_name,
    itemsCount: number(row.items_count),
    grossAmount: number(row.gross_amount),
    discountAmount: number(row.discount_amount),
    refundAmount: number(row.refund_amount),
    netRevenue: number(row.net_revenue),
    paymentMethod: row.payment_method,
    currency: row.currency,
    included: row.analytics_included
  };
}

function sortExpression(filters: AnalyticsFilters) {
  const expressions: Record<AnalyticsFilters["sort"], string> = {
    date: "s.analytics_at",
    number: "s.order_number",
    channel: "s.source",
    location: "s.location_name",
    total: "s.gross_amount",
    net: "s.net_revenue",
    status: "s.status"
  };
  return `${expressions[filters.sort]} ${filters.direction === "asc" ? "asc" : "desc"}, s.sale_id ${
    filters.direction === "asc" ? "asc" : "desc"
  }`;
}

export async function getAnalyticsSaleDetail(params: {
  saleId: string;
  scope: AnalyticsScope;
}): Promise<AnalyticsSaleDetail | null> {
  const { saleId, scope } = params;
  const locationCondition = scope.locationIds === null
    ? { text: "true", values: [] as unknown[] }
    : scope.locationIds.length
      ? { text: "s.location_id = any($2::text[])", values: [scope.locationIds] as unknown[] }
      : { text: "false", values: [] as unknown[] };
  const values = [saleId, ...locationCondition.values];
  const sql = getPostgresSql();
  const sales = await sql.unsafe<SaleDatabaseRow[]>(`
    select s.*
    from public.canonical_analytics_sales s
    where s.sale_id = $1 and ${locationCondition.text}
    limit 1
  `, values as never[]);
  const row = sales[0];
  if (!row) return null;

  const [itemRows, paymentRows] = await Promise.all([
    sql.unsafe<{
      sale_item_id: string;
      product_id: string | null;
      source_product_id: string | null;
      product_name: string;
      category: string | null;
      mapping_status: string;
      quantity: string | number;
      unit_price: string | number;
      discount_amount: string | number;
      net_revenue: string | number;
    }[]>(`
      select sale_item_id, product_id, source_product_id, product_name, category,
        mapping_status, quantity, unit_price, discount_amount, net_revenue
      from public.analytics_sale_items
      where sale_id = $1
      order by product_name, sale_item_id
    `, [saleId] as never[]),
    sql.unsafe<{
      payment_id: string;
      payment_method: string;
      source_payment_method: string;
      amount: string | number;
      paid_at: string | null;
    }[]>(`
      select payment_id, payment_method, source_payment_method, amount, paid_at
      from public.analytics_sale_payments
      where sale_id = $1
      order by paid_at nulls last, payment_id
    `, [saleId] as never[])
  ]);

  const items: AnalyticsSaleItem[] = itemRows.map((item) => ({
    id: item.sale_item_id,
    productId: item.product_id,
    sourceProductId: item.source_product_id,
    name: item.product_name,
    category: item.category,
    mappingStatus: item.mapping_status,
    quantity: number(item.quantity),
    unitPrice: number(item.unit_price),
    discount: number(item.discount_amount),
    total: number(item.net_revenue)
  }));
  const payments: AnalyticsSalePayment[] = paymentRows.map((payment) => ({
    id: payment.payment_id,
    method: payment.payment_method,
    sourceMethod: payment.source_payment_method,
    amount: number(payment.amount),
    paidAt: payment.paid_at
  }));

  return {
    sale: mapSale(row),
    items,
    payments,
    technical: {
      sourceRecordId: String(row.source_record_id ?? ""),
      externalSourceId: row.external_source_id,
      sourceUpdatedAt: row.source_updated_at ?? null
    }
  };
}

export async function getAnalyticsSalesPage(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
  selectedSaleId?: string | null;
}): Promise<AnalyticsSalesPage> {
  const { filters, range, scope } = params;
  const where = buildSalesWhere(filters, range, scope, { alias: "s", includeSearch: true });
  const sql = getPostgresSql();
  const [totals, options, detail] = await Promise.all([
    sql.unsafe<{ total_rows: string | number; total_revenue: string | number }[]>(`
      select count(*)::bigint as total_rows,
        coalesce(sum(s.net_revenue) filter (where s.analytics_included), 0)::numeric as total_revenue
      from public.canonical_analytics_sales s
      where ${where.text}
    `, where.values as never[]),
    getAnalyticsFilterOptions(scope),
    params.selectedSaleId ? getAnalyticsSaleDetail({ saleId: params.selectedSaleId, scope }) : null
  ]);
  const totalRows = number(totals[0]?.total_rows);
  const pageCount = Math.max(1, Math.ceil(totalRows / filters.pageSize));
  const currentPage = Math.min(filters.page, pageCount);
  const offset = (currentPage - 1) * filters.pageSize;
  const paginationValues = [...where.values, filters.pageSize, offset];
  const limitPlaceholder = `$${where.values.length + 1}`;
  const offsetPlaceholder = `$${where.values.length + 2}`;
  const rows = await sql.unsafe<SaleDatabaseRow[]>(`
    select s.sale_id, s.external_source_id, s.source, s.source_subtype,
      s.order_number, s.analytics_at, s.status, s.operation_type,
      s.location_name, s.terminal_name, s.employee_name, s.customer_name,
      s.items_count, s.gross_amount, s.discount_amount, s.refund_amount,
      s.net_revenue, s.payment_method, s.currency, s.analytics_included
    from public.canonical_analytics_sales s
    where ${where.text}
    order by ${sortExpression(filters)}
    limit ${limitPlaceholder} offset ${offsetPlaceholder}
  `, paginationValues as never[]);

  return {
    rows: rows.map(mapSale),
    totalRows,
    totalRevenue: number(totals[0]?.total_revenue),
    page: currentPage,
    pageSize: filters.pageSize,
    pageCount,
    options,
    detail,
    error: null
  };
}

export type SalesExportCursor = { analyticsAt: string; saleId: string } | null;

export async function getAnalyticsSalesExportBatch(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
  cursor: SalesExportCursor;
  limit?: number;
}) {
  const where = buildSalesWhere(params.filters, params.range, params.scope, {
    alias: "s",
    includeSearch: true
  });
  const values = [...where.values];
  let cursorClause = "";
  if (params.cursor) {
    const datePlaceholder = `$${values.push(params.cursor.analyticsAt)}`;
    const idPlaceholder = `$${values.push(params.cursor.saleId)}`;
    cursorClause = `and (s.analytics_at, s.sale_id) < (${datePlaceholder}::timestamptz, ${idPlaceholder})`;
  }
  const limit = Math.min(1_000, Math.max(100, params.limit ?? 500));
  const limitPlaceholder = `$${values.push(limit)}`;
  const sql = getPostgresSql();
  const rows = await sql.unsafe<SaleDatabaseRow[]>(`
    select s.sale_id, s.external_source_id, s.source, s.source_subtype,
      s.order_number, s.analytics_at, s.status, s.operation_type,
      s.location_name, s.terminal_name, s.employee_name, s.customer_name,
      s.items_count, s.gross_amount, s.discount_amount, s.refund_amount,
      s.net_revenue, s.payment_method, s.currency, s.analytics_included
    from public.canonical_analytics_sales s
    where ${where.text} ${cursorClause}
    order by s.analytics_at desc, s.sale_id desc
    limit ${limitPlaceholder}
  `, values as never[]);
  return rows.map(mapSale);
}
