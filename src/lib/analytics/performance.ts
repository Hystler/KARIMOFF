import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { getAnalyticsRange } from "./periods";

type PlanNode = {
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  "Index Name"?: string;
  "Node Type"?: string;
  "Relation Name"?: string;
  Plans?: PlanNode[];
};

type ExplainDocument = {
  "Execution Time"?: number;
  Plan?: PlanNode;
  "Planning Time"?: number;
};

export type AnalyticsPlanSummary = {
  actualRows: number;
  executionTimeMs: number;
  indexScans: Array<{ index: string | null; relation: string | null; rows: number }>;
  name: string;
  planningTimeMs: number;
  sequentialScans: Array<{ relation: string | null; rows: number }>;
  topNode: string;
};

export class AnalyticsPerformanceQueryError extends Error {
  constructor(
    readonly queryName: string,
    readonly databaseCode: string | null
  ) {
    super(`Analytics performance query failed: ${queryName}.`);
    this.name = "AnalyticsPerformanceQueryError";
  }
}

const representativeQueries: Array<{ name: string; text: string }> = [
  {
    name: "revenue_trend",
    text: `
      select date_trunc('day', s.analytics_at at time zone 'Europe/Moscow') as bucket,
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        count(*) filter (where s.sale_count_eligible)::integer as sales
      from public.canonical_analytics_sales s
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1 order by 1
    `
  },
  {
    name: "weekday_hour_heatmap",
    text: `
      select extract(isodow from s.analytics_at at time zone 'Europe/Moscow')::integer as weekday,
        extract(hour from s.analytics_at at time zone 'Europe/Moscow')::integer as hour,
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        count(*) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items
      from public.canonical_analytics_sales s
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1, 2 order by 1, 2
    `
  },
  {
    name: "calendar_heatmap",
    text: `
      select date_trunc('day', s.analytics_at at time zone 'Europe/Moscow') as day,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts,
        coalesce(sum(i.gross_amount - i.discount_amount), 0)::numeric as sale_revenue
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1 order by 1
    `
  },
  {
    name: "top_products",
    text: `
      select coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
        min(i.product_name) as product_name,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1 order by revenue desc limit 20
    `
  },
  {
    name: "category_comparison",
    text: `
      select coalesce(i.category, 'Категория не указана') as category,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1 order by revenue desc
    `
  },
  {
    name: "basket_analysis",
    text: `
      with basket_items as (
        select distinct i.sale_id,
          coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key
        from public.analytics_sale_items i
        join public.canonical_analytics_sales s on s.sale_id = i.sale_id
        where s.included_in_analytics and s.sale_count_eligible
          and s.analytics_at >= $1 and s.analytics_at < $2
          and i.operation_type = 'sale' and i.quantity > 0
      )
      select left_item.product_key, right_item.product_key,
        count(distinct left_item.sale_id)::integer as baskets
      from basket_items left_item
      join basket_items right_item
        on right_item.sale_id = left_item.sale_id and right_item.product_key > left_item.product_key
      group by 1, 2
      having count(distinct left_item.sale_id) >= 2
      order by baskets desc limit 16
    `
  },
  {
    name: "treemap",
    text: `
      select coalesce(i.category, 'Категория не указана') as category,
        coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1, 2 order by revenue desc limit 48
    `
  },
  {
    name: "pareto_abc",
    text: `
      with products as (
        select coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
          coalesce(sum(i.net_revenue), 0)::numeric as revenue
        from public.canonical_analytics_sales s
        join public.analytics_sale_items i on i.sale_id = s.sale_id
        where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
        group by 1
      )
      select product_key, revenue,
        sum(revenue) over (order by revenue desc rows unbounded preceding)
          / nullif(sum(revenue) over (), 0) as cumulative_share
      from products order by revenue desc
    `
  },
  {
    name: "dayparts",
    text: `
      select case
          when extract(hour from s.analytics_at at time zone 'Europe/Moscow') between 11 and 13 then 'lunch'
          when extract(hour from s.analytics_at at time zone 'Europe/Moscow') between 14 and 16 then 'afternoon'
          when extract(hour from s.analytics_at at time zone 'Europe/Moscow') between 17 and 20 then 'evening'
          else 'other'
        end as daypart,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue,
        count(distinct s.sale_id) filter (where s.sale_count_eligible)::integer as receipts,
        coalesce(sum(i.quantity) filter (where i.operation_type = 'sale'), 0)::numeric as quantity
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      group by 1
    `
  },
  {
    name: "revenue_decomposition",
    text: `
      select
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        coalesce(sum(s.gross_amount - s.discount_amount) filter (where s.sale_count_eligible), 0)::numeric as sale_revenue,
        count(*) filter (where s.sale_count_eligible)::integer as sales,
        coalesce(sum(s.refund_amount), 0)::numeric as refunds,
        coalesce(sum(s.items_count) filter (where s.sale_count_eligible), 0)::numeric as items
      from public.canonical_analytics_sales s
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
    `
  },
  {
    name: "filtered_sales_journal",
    text: `
      select s.sale_id, s.analytics_at, s.order_number, s.source, s.location_name,
        s.net_revenue, s.payment_method, s.status
      from public.canonical_analytics_sales s
      where s.included_in_analytics and s.analytics_at >= $1 and s.analytics_at < $2
      order by s.analytics_at desc, s.sale_id desc
      limit 25
    `
  }
];

function summarizeNode(
  node: PlanNode,
  summary: Pick<AnalyticsPlanSummary, "indexScans" | "sequentialScans">
) {
  const nodeType = node["Node Type"] ?? "";
  if (nodeType.includes("Seq Scan")) {
    summary.sequentialScans.push({
      relation: node["Relation Name"] ?? null,
      rows: node["Actual Rows"] ?? 0
    });
  }
  if (nodeType.includes("Index")) {
    summary.indexScans.push({
      index: node["Index Name"] ?? null,
      relation: node["Relation Name"] ?? null,
      rows: node["Actual Rows"] ?? 0
    });
  }
  for (const child of node.Plans ?? []) summarizeNode(child, summary);
}

function summarizePlan(name: string, document: ExplainDocument): AnalyticsPlanSummary {
  const root = document.Plan ?? {};
  const summary: AnalyticsPlanSummary = {
    actualRows: root["Actual Rows"] ?? 0,
    executionTimeMs: document["Execution Time"] ?? root["Actual Total Time"] ?? 0,
    indexScans: [],
    name,
    planningTimeMs: document["Planning Time"] ?? 0,
    sequentialScans: [],
    topNode: root["Node Type"] ?? "Unknown"
  };
  summarizeNode(root, summary);
  return summary;
}

export async function explainRepresentativeAnalyticsQueries() {
  const range = getAnalyticsRange({ period: "30d" });
  const sql = getPostgresSql();

  return sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction read only");
    await transaction.unsafe("set local statement_timeout = '12s'");
    const summaries: AnalyticsPlanSummary[] = [];

    for (const query of representativeQueries) {
      try {
        const rows = await transaction.unsafe<Record<string, unknown>[]>(
          `explain (analyze, buffers, format json) ${query.text}`,
          [range.from.toISOString(), range.to.toISOString()]
        );
        const raw = rows[0]?.["QUERY PLAN"];
        const document = (Array.isArray(raw) ? raw[0] : raw) as ExplainDocument | undefined;
        if (!document) throw new Error("missing_plan");
        summaries.push(summarizePlan(query.name, document));
      } catch (error) {
        const databaseCode =
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : null;
        throw new AnalyticsPerformanceQueryError(query.name, databaseCode);
      }
    }

    return { range: range.label, summaries };
  });
}
