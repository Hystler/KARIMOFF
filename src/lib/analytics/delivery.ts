import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { countAnalyticsCalendarDays } from "./periods";
import { buildSalesWhere } from "./query";
import type { AnalyticsFilters, AnalyticsRange, AnalyticsScope, DeliveryAnalyticsSummary } from "./types";

type DeliverySummaryRow = {
  delivered_orders: number | string;
  revenue: number | string;
  average_check: number | string | null;
  merchandise_revenue: number | string;
  delivery_fee_revenue: number | string;
  paid_deliveries: number | string;
  free_deliveries: number | string;
  refund_amount: number | string;
  cancelled_orders: number | string;
  average_paid_to_delivered_seconds: number | string | null;
  average_ready_to_delivered_seconds: number | string | null;
};

function number(value: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getDeliveryAnalyticsSummary(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
}): Promise<DeliveryAnalyticsSummary> {
  const { filters, range, scope } = params;
  const where = buildSalesWhere(filters, range, scope, { alias: "s" });
  const sql = getPostgresSql();
  const [row] = await sql.unsafe<DeliverySummaryRow[]>(`
    select
      count(*) filter (where s.analytics_included)::integer as delivered_orders,
      coalesce(sum(s.net_revenue) filter (where s.analytics_included), 0)::numeric as revenue,
      (avg(s.net_revenue) filter (where s.analytics_included))::numeric as average_check,
      coalesce(sum(greatest(0, s.net_revenue - order_row.delivery_fee)) filter (where s.analytics_included), 0)::numeric as merchandise_revenue,
      coalesce(sum(case when order_row.payment_status = 'refunded' then 0 else order_row.delivery_fee end)
        filter (where s.analytics_included), 0)::numeric as delivery_fee_revenue,
      count(*) filter (where s.analytics_included and order_row.delivery_fee > 0)::integer as paid_deliveries,
      count(*) filter (where s.analytics_included and order_row.delivery_fee = 0)::integer as free_deliveries,
      coalesce(sum(s.refund_amount), 0)::numeric as refund_amount,
      count(*) filter (where order_row.status = 'cancelled')::integer as cancelled_orders,
      (avg(extract(epoch from (order_row.handed_out_at - paid.first_paid_at)))
        filter (where order_row.handed_out_at is not null and paid.first_paid_at is not null))::numeric as average_paid_to_delivered_seconds,
      (avg(extract(epoch from (order_row.handed_out_at - order_row.ready_at)))
        filter (where order_row.handed_out_at is not null and order_row.ready_at is not null))::numeric as average_ready_to_delivered_seconds
    from public.canonical_analytics_sales s
    join public.orders order_row on s.sale_id = 'web:' || order_row.id::text
    left join lateral (
      select min(payment.paid_at) as first_paid_at
      from public.payments payment
      where payment.order_id = order_row.id and payment.provider = 'yookassa' and payment.paid_at is not null
    ) paid on true
    where ${where.text}
      and order_row.delivery_type = 'delivery'
  `, where.values as never[]);
  const days = countAnalyticsCalendarDays(range, filters.weekdays);
  const deliveredOrders = number(row?.delivered_orders ?? 0);
  const paidDeliveries = number(row?.paid_deliveries ?? 0);
  const freeDeliveries = number(row?.free_deliveries ?? 0);
  const knownDeliveries = paidDeliveries + freeDeliveries;

  return {
    deliveredOrders,
    revenue: number(row?.revenue ?? 0),
    averageCheck: row?.average_check === null || row?.average_check === undefined ? null : number(row.average_check),
    merchandiseRevenue: number(row?.merchandise_revenue ?? 0),
    deliveryFeeRevenue: number(row?.delivery_fee_revenue ?? 0),
    paidDeliveries,
    freeDeliveries,
    freeDeliveryShare: knownDeliveries ? freeDeliveries / knownDeliveries : null,
    refundAmount: number(row?.refund_amount ?? 0),
    cancelledOrders: number(row?.cancelled_orders ?? 0),
    averagePaidToDeliveredSeconds: row?.average_paid_to_delivered_seconds === null || row?.average_paid_to_delivered_seconds === undefined
      ? null
      : number(row.average_paid_to_delivered_seconds),
    averageReadyToDeliveredSeconds: row?.average_ready_to_delivered_seconds === null || row?.average_ready_to_delivered_seconds === undefined
      ? null
      : number(row.average_ready_to_delivered_seconds),
    ordersPerDay: days ? deliveredOrders / days : null
  };
}
