import "server-only";

import { getMoscowDateKey } from "@/lib/order-time";
import { getAdminOrders } from "@/lib/orders";
import { getPostgresSql } from "@/lib/postgres/server";
import { getEvotorConnectionOverview } from "@/lib/integrations/evotor/repository";

export type ErpPeriod = "today" | "month" | "30d";

export function getErpPeriodRange(period: string, now = new Date()) {
  const normalized: ErpPeriod = period === "month" || period === "30d" ? period : "today";
  const today = getMoscowDateKey(now);
  const until = new Date(`${today}T23:59:59.999+03:00`);
  let since: Date;

  if (normalized === "month") {
    since = new Date(`${today.slice(0, 8)}01T00:00:00+03:00`);
  } else if (normalized === "30d") {
    since = new Date(until.getTime() - 29 * 24 * 60 * 60 * 1000);
    since = new Date(`${getMoscowDateKey(since)}T00:00:00+03:00`);
  } else {
    since = new Date(`${today}T00:00:00+03:00`);
  }

  return { period: normalized, since, until };
}

type ReceiptRow = {
  id: string;
  receipt_type: "sale" | "return" | "correction";
  closed_at: string | null;
  total: number;
  payment_types: Array<{ type?: string; sum?: number }>;
  register_name: string;
};

type ReceiptItemRow = {
  receipt_id: string;
  evotor_product_id: string | null;
  name: string;
  quantity: number;
  line_total: number;
  receipt_type: "sale" | "return" | "correction";
};

export async function getErpDashboard(periodValue: string) {
  const range = getErpPeriodRange(periodValue);
  const sql = getPostgresSql();
  const [{ orders, error: ordersError }, receipts, receiptItems, connections] = await Promise.all([
    getAdminOrders(),
    sql<ReceiptRow[]>`
      select r.id, r.receipt_type, r.closed_at, r.total, r.payment_types,
        coalesce(d.name, d.device_model, s.name, 'Касса Эвотор') as register_name
      from public.evotor_receipts r
      join public.evotor_stores s on s.id = r.store_id
      left join public.evotor_devices d on d.id = r.device_id
      where r.closed_at >= ${range.since.toISOString()}::timestamptz
        and r.closed_at <= ${range.until.toISOString()}::timestamptz
      order by r.closed_at
    `,
    sql<ReceiptItemRow[]>`
      select i.receipt_id, i.evotor_product_id, i.name, i.quantity, i.line_total, r.receipt_type
      from public.evotor_receipt_items i
      join public.evotor_receipts r on r.id = i.receipt_id
      where r.closed_at >= ${range.since.toISOString()}::timestamptz
        and r.closed_at <= ${range.until.toISOString()}::timestamptz
    `,
    getEvotorConnectionOverview()
  ]);
  const periodOrders = orders.filter((order) => {
    const createdAt = new Date(order.created_at).getTime();
    return createdAt >= range.since.getTime() && createdAt <= range.until.getTime();
  });
  const completedOrders = periodOrders.filter((order) => order.status === "completed");
  const sales = receipts.filter((receipt) => receipt.receipt_type === "sale");
  const returns = receipts.filter((receipt) => receipt.receipt_type === "return");

  const siteRevenue = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const evotorSales = sales.reduce((sum, receipt) => sum + Number(receipt.total), 0);
  const refundAmount = returns.reduce((sum, receipt) => sum + Number(receipt.total), 0);
  const evotorRevenue = evotorSales - refundAmount;
  const topProducts = new Map<string, { name: string; quantity: number; revenue: number }>();
  const daily = new Map<string, { date: string; site: number; evotor: number }>();
  const registers = new Map<string, { name: string; checks: number; revenue: number }>();
  const paymentMethods = new Map<string, { name: string; checks: number; revenue: number }>();

  for (const order of completedOrders) {
    const date = getMoscowDateKey(new Date(order.created_at));
    const day = daily.get(date) ?? { date, site: 0, evotor: 0 };
    day.site += order.total;
    daily.set(date, day);
    for (const item of order.items) {
      const key = item.product_id ?? item.product_name;
      const current = topProducts.get(key) ?? { name: item.product_name, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.line_total;
      topProducts.set(key, current);
    }
  }

  for (const receipt of receipts) {
    if (!receipt.closed_at) continue;
    const sign = receipt.receipt_type === "return" ? -1 : 1;
    const date = getMoscowDateKey(new Date(receipt.closed_at));
    const day = daily.get(date) ?? { date, site: 0, evotor: 0 };
    day.evotor += Number(receipt.total) * sign;
    daily.set(date, day);
    const register = registers.get(receipt.register_name) ?? { name: receipt.register_name, checks: 0, revenue: 0 };
    register.checks += 1;
    register.revenue += Number(receipt.total) * sign;
    registers.set(receipt.register_name, register);
    for (const payment of Array.isArray(receipt.payment_types) ? receipt.payment_types : []) {
      const name = String(payment.type ?? "UNKNOWN");
      const current = paymentMethods.get(name) ?? { name, checks: 0, revenue: 0 };
      current.checks += 1;
      current.revenue += Number(payment.sum ?? 0) * sign;
      paymentMethods.set(name, current);
    }
  }

  for (const item of receiptItems) {
    const sign = item.receipt_type === "return" ? -1 : 1;
    const key = `evotor:${item.evotor_product_id ?? item.name}`;
    const current = topProducts.get(key) ?? { name: item.name, quantity: 0, revenue: 0 };
    current.quantity += Number(item.quantity) * sign;
    current.revenue += Number(item.line_total) * sign;
    topProducts.set(key, current);
  }

  const totalChecks = completedOrders.length + sales.length;
  const totalRevenue = siteRevenue + evotorRevenue;

  return {
    range,
    status: {
      enabled: process.env.EVOTOR_ENABLED === "true",
      configured: connections.length > 0,
      ready: process.env.EVOTOR_ENABLED === "true" && connections.some((item) => item.status === "connected")
    },
    error: ordersError,
    siteOrders: periodOrders.length,
    completedSiteOrders: completedOrders.length,
    siteRevenue,
    evotorChecks: sales.length,
    evotorRevenue,
    refundCount: returns.length,
    refundAmount,
    totalRevenue,
    averageCheck: totalChecks ? (siteRevenue + evotorSales) / totalChecks : 0,
    topProducts: Array.from(topProducts.values())
      .filter((item) => item.quantity > 0)
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, 10),
    daily: Array.from(daily.values()).sort((left, right) => left.date.localeCompare(right.date)),
    registers: Array.from(registers.values()).sort((left, right) => right.revenue - left.revenue),
    paymentMethods: Array.from(paymentMethods.values()).sort((left, right) => right.revenue - left.revenue)
  };
}
