import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";

export type ReconciliationOrder = {
  id: string;
  displayNumber: string;
  source: string;
  createdAt: string;
  total: number;
  locationId: string;
  locationName: string;
};

export type ReconciliationReceipt = {
  id: string;
  number: string;
  closedAt: string;
  total: number;
  locationId: string | null;
  locationName: string;
};

export type ConfirmedReconciliation = {
  id: string;
  orderId: string;
  orderNumber: string;
  orderSource: string;
  receiptId: string;
  receiptNumber: string;
  orderTotal: number;
  receiptTotal: number;
  confirmedAt: string | null;
  locationId: string;
  locationName: string;
};

function scopeClause(alias: string, locationIds: string[] | null, parameter: number) {
  if (locationIds === null) return "true";
  if (!locationIds.length) return "false";
  return `${alias}.location_id = any($${parameter}::uuid[])`;
}

export async function getOrderReconciliationWorkspace(locationIds: string[] | null) {
  const sql = getPostgresSql();
  const values = locationIds === null ? [] : [locationIds];
  const orderScope = scopeClause("orders", locationIds, 1);
  const receiptScope = scopeClause("store", locationIds, 1);

  const [orders, receipts, confirmed] = await Promise.all([
    sql.unsafe<{
      id: string;
      display_number: string | null;
      source: string;
      created_at: string;
      total: string | number;
      location_id: string;
      location_name: string;
    }[]>(`
      select orders.id, orders.display_number, orders.source, orders.created_at,
        orders.total, orders.location_id, location.name as location_name
      from public.orders
      join public.order_locations location on location.id = orders.location_id
      where ${orderScope}
        and orders.source in ('web', 'pos', 'mobile', 'kiosk')
        and orders.created_at >= now() - interval '14 days'
        and not exists (
          select 1 from public.analytics_sale_reconciliations link
          where link.web_order_id = orders.id and link.status = 'confirmed'
        )
      order by orders.created_at desc
      limit 100
    `, values as never[]),
    sql.unsafe<{
      id: string;
      receipt_number: string;
      closed_at: string;
      total: string | number;
      location_id: string | null;
      location_name: string;
    }[]>(`
      select receipt.id,
        coalesce(receipt.receipt_number, receipt.fiscal_document_number, receipt.external_receipt_id) as receipt_number,
        receipt.closed_at, receipt.total, store.location_id, store.name as location_name
      from public.evotor_receipts receipt
      join public.evotor_stores store on store.id = receipt.store_id
      where ${receiptScope}
        and receipt.receipt_type = 'sale'
        and receipt.closed_at >= now() - interval '14 days'
        and not exists (
          select 1 from public.analytics_sale_reconciliations link
          where link.evotor_receipt_id = receipt.id and link.status = 'confirmed'
        )
      order by receipt.closed_at desc
      limit 100
    `, values as never[]),
    sql.unsafe<{
      id: string;
      order_id: string;
      order_number: string | null;
      order_source: string;
      receipt_id: string;
      receipt_number: string;
      order_total: string | number;
      receipt_total: string | number;
      confirmed_at: string | null;
      location_id: string;
      location_name: string;
    }[]>(`
      select link.id, orders.id as order_id, orders.display_number as order_number,
        orders.source as order_source, receipt.id as receipt_id,
        coalesce(receipt.receipt_number, receipt.fiscal_document_number, receipt.external_receipt_id) as receipt_number,
        orders.total as order_total, receipt.total as receipt_total, link.confirmed_at,
        orders.location_id, location.name as location_name
      from public.analytics_sale_reconciliations link
      join public.orders on orders.id = link.web_order_id
      join public.evotor_receipts receipt on receipt.id = link.evotor_receipt_id
      join public.order_locations location on location.id = orders.location_id
      where link.status = 'confirmed' and ${orderScope}
      order by link.confirmed_at desc nulls last, link.updated_at desc
      limit 50
    `, values as never[])
  ]);

  return {
    orders: orders.map((row): ReconciliationOrder => ({
      id: row.id,
      displayNumber: row.display_number || row.id.slice(0, 8).toUpperCase(),
      source: row.source,
      createdAt: row.created_at,
      total: Number(row.total),
      locationId: row.location_id,
      locationName: row.location_name
    })),
    receipts: receipts.map((row): ReconciliationReceipt => ({
      id: row.id,
      number: row.receipt_number,
      closedAt: row.closed_at,
      total: Number(row.total),
      locationId: row.location_id,
      locationName: row.location_name
    })),
    confirmed: confirmed.map((row): ConfirmedReconciliation => ({
      id: row.id,
      orderId: row.order_id,
      orderNumber: row.order_number || row.order_id.slice(0, 8).toUpperCase(),
      orderSource: row.order_source,
      receiptId: row.receipt_id,
      receiptNumber: row.receipt_number,
      orderTotal: Number(row.order_total),
      receiptTotal: Number(row.receipt_total),
      confirmedAt: row.confirmed_at,
      locationId: row.location_id,
      locationName: row.location_name
    }))
  };
}
