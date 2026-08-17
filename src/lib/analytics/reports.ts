import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { buildItemWhere, buildSalesWhere } from "./query";
import type { AnalyticsFilters, AnalyticsRange, AnalyticsScope } from "./types";

export type AnalyticsReportRow = {
  key: string;
  name: string;
  category: string;
  revenue: number;
  quantity: number;
  receipts: number;
  averageItemPrice: number;
  share: number;
  mappingStatus: string;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAnalyticsReportRows(params: {
  report: "products" | "categories";
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
}) {
  const sales = buildSalesWhere(params.filters, params.range, params.scope, {
    alias: "s",
    includedOnly: true,
    includeItemFilters: false
  });
  const items = buildItemWhere(params.filters, { alias: "i", offset: sales.values.length });
  const product = params.report === "products";
  const key = product
    ? "coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id))"
    : "coalesce(i.category, '__unknown__')";
  const name = product ? "i.product_name" : "coalesce(i.category, 'Категория не указана')";
  const category = product ? "coalesce(max(i.category), 'Категория не указана')" : name;
  const mapping = product
    ? "case when bool_and(i.mapping_status in ('native', 'confirmed')) then 'mapped' else 'unmapped' end"
    : "'category'::text";
  const sql = getPostgresSql();
  const rows = await sql.unsafe<Array<{
    key: string;
    name: string;
    category: string;
    revenue: string | number;
    quantity: string | number;
    receipts: string | number;
    average_item_price: string | number;
    share: string | number;
    mapping_status: string;
  }>>(`
    with report_rows as (
      select ${key} as key, ${name} as name, ${category} as category,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts,
        ${mapping} as mapping_status
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${sales.text} and ${items.text}
      group by 1, 2
    )
    select *,
      case when quantity <> 0 then revenue / quantity else 0 end::numeric as average_item_price,
      case when sum(revenue) over () <> 0 then revenue / sum(revenue) over () * 100 else 0 end::numeric as share
    from report_rows
    order by revenue desc, name
    limit 10000
  `, [...sales.values, ...items.values] as never[]);
  return rows.map((row): AnalyticsReportRow => ({
    key: row.key,
    name: row.name,
    category: row.category,
    revenue: number(row.revenue),
    quantity: number(row.quantity),
    receipts: number(row.receipts),
    averageItemPrice: number(row.average_item_price),
    share: number(row.share),
    mappingStatus: row.mapping_status
  }));
}
