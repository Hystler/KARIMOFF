import "server-only";

import { createDatabaseServerClient } from "@/lib/database/server";
import { getMoscowDateKey } from "@/lib/order-time";
import { getAdminOrders } from "@/lib/orders";
import { getEvotorStatus, type EvotorSaleDocument } from "@/lib/evotor/client";

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

function asEvotorDocument(value: unknown): EvotorSaleDocument | null {
  if (!value || typeof value !== "object") return null;
  const document = value as Partial<EvotorSaleDocument>;
  if (!document.id || !document.close_date || !Array.isArray(document.items)) return null;
  return {
    id: String(document.id),
    number: document.number === null || document.number === undefined ? null : Number(document.number),
    close_date: String(document.close_date),
    device_id: document.device_id ? String(document.device_id) : null,
    store_id: String(document.store_id ?? ""),
    total: Number(document.total ?? 0),
    items: document.items.map((item) => ({
      product_id: item.product_id ? String(item.product_id) : null,
      name: String(item.name ?? "Позиция"),
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.total ?? 0)
    }))
  };
}

export async function getErpDashboard(periodValue: string) {
  const range = getErpPeriodRange(periodValue);
  const database = createDatabaseServerClient();
  const { orders, error: ordersError } = await getAdminOrders();
  const periodOrders = orders.filter((order) => {
    const createdAt = new Date(order.created_at).getTime();
    return createdAt >= range.since.getTime() && createdAt <= range.until.getTime();
  });
  const completedOrders = periodOrders.filter((order) => order.status === "completed");

  let evotorDocuments: EvotorSaleDocument[] = [];
  let evotorError: string | null = null;
  if (database) {
    const { data, error } = await database
      .from("cash_register_events")
      .select("payload")
      .eq("event_type", "evotor.document.sell")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) {
      evotorError = error.message;
    } else {
      evotorDocuments = (data ?? [])
        .map((row) => asEvotorDocument(row.payload))
        .filter((item): item is EvotorSaleDocument => Boolean(item))
        .filter((item) => {
          const createdAt = new Date(item.close_date).getTime();
          return createdAt >= range.since.getTime() && createdAt <= range.until.getTime();
        });
    }
  }

  const siteRevenue = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const evotorRevenue = evotorDocuments.reduce((sum, document) => sum + document.total, 0);
  const topProducts = new Map<string, { name: string; quantity: number; revenue: number }>();
  const daily = new Map<string, { date: string; site: number; evotor: number }>();

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

  for (const document of evotorDocuments) {
    const date = getMoscowDateKey(new Date(document.close_date));
    const day = daily.get(date) ?? { date, site: 0, evotor: 0 };
    day.evotor += document.total;
    daily.set(date, day);
    for (const item of document.items) {
      const key = `evotor:${item.product_id ?? item.name}`;
      const current = topProducts.get(key) ?? { name: item.name, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.total;
      topProducts.set(key, current);
    }
  }

  const totalChecks = completedOrders.length + evotorDocuments.length;
  const totalRevenue = siteRevenue + evotorRevenue;

  return {
    range,
    status: getEvotorStatus(),
    error: ordersError ?? evotorError,
    siteOrders: periodOrders.length,
    completedSiteOrders: completedOrders.length,
    siteRevenue,
    evotorChecks: evotorDocuments.length,
    evotorRevenue,
    totalRevenue,
    averageCheck: totalChecks ? totalRevenue / totalChecks : 0,
    topProducts: Array.from(topProducts.values())
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, 10),
    daily: Array.from(daily.values()).sort((left, right) => left.date.localeCompare(right.date))
  };
}
