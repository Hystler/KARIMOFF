import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminOrderItem = {
  id: string;
  order_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type AdminOrder = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  delivery_type: "pickup" | "delivery";
  address: string | null;
  comment: string | null;
  status: "new" | "in_progress" | "completed" | "cancelled";
  total: number;
  items: AdminOrderItem[];
};

function normalizeOrder(row: Record<string, unknown>, items: AdminOrderItem[]): AdminOrder {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    customer_name: String(row.customer_name ?? ""),
    customer_phone: String(row.customer_phone ?? ""),
    delivery_type: row.delivery_type === "delivery" ? "delivery" : "pickup",
    address: typeof row.address === "string" ? row.address : null,
    comment: typeof row.comment === "string" ? row.comment : null,
    status:
      row.status === "in_progress" || row.status === "completed" || row.status === "cancelled"
        ? row.status
        : "new",
    total: Number(row.total ?? 0),
    items
  };
}

function normalizeItem(row: Record<string, unknown>): AdminOrderItem {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    product_name: String(row.product_name ?? ""),
    unit_price: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    line_total: Number(row.line_total ?? 0)
  };
}

export async function getAdminOrders() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id, created_at, customer_name, customer_phone, delivery_type, address, comment, status, total")
    .order("created_at", { ascending: false });

  if (ordersError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: ordersError.message
    };
  }

  const orderIds = (ordersData ?? []).map((order) => String(order.id));

  if (!orderIds.length) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: null as string | null
    };
  }

  const { data: itemsData, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, product_name, unit_price, quantity, line_total")
    .in("order_id", orderIds);

  if (itemsError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: itemsError.message
    };
  }

  const items = (itemsData ?? []).map((item) => normalizeItem(item));
  const orders = (ordersData ?? []).map((order) =>
    normalizeOrder(
      order,
      items.filter((item) => item.order_id === String(order.id))
    )
  );

  return {
    orders,
    notConfigured: false,
    error: null as string | null
  };
}
