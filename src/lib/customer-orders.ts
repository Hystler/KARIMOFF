import "server-only";

import { createDatabaseServerClient } from "@/lib/database/server";
import { formatMissingTableError } from "@/lib/database/errors";

export type CustomerOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  modifiers: Array<{
    id: string;
    modifier_type: "remove" | "add" | "replace";
    ingredient_name: string;
  }>;
};

export type CustomerOrder = {
  id: string;
  created_at: string;
  updated_at: string;
  display_number: string;
  delivery_type: "pickup" | "delivery";
  address: string | null;
  comment: string | null;
  status: "new" | "in_progress" | "completed" | "cancelled";
  kitchen_status: "new" | "accepted" | "cooking" | "ready" | "handed_out" | "cancelled";
  payment_status: "not_required" | "pending" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
  fiscal_status: "not_required" | "pending" | "issued" | "failed" | "refunded";
  fulfillment_mode: "asap" | "scheduled";
  requested_at: string | null;
  accepted_at: string | null;
  cooking_started_at: string | null;
  ready_at: string | null;
  handed_out_at: string | null;
  cancelled_at: string | null;
  total: number;
  items: CustomerOrderItem[];
};

export type CustomerOrderStatus = Pick<
  CustomerOrder,
  | "accepted_at"
  | "cancelled_at"
  | "cooking_started_at"
  | "fiscal_status"
  | "handed_out_at"
  | "id"
  | "kitchen_status"
  | "payment_status"
  | "ready_at"
  | "status"
  | "updated_at"
>;

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeOrder(row: Record<string, unknown>, items: CustomerOrderItem[]): CustomerOrder {
  const id = String(row.id);
  return {
    id,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    display_number: typeof row.display_number === "string" ? row.display_number : id.slice(0, 8),
    delivery_type: row.delivery_type === "delivery" ? "delivery" : "pickup",
    address: nullableString(row.address),
    comment: nullableString(row.comment),
    status:
      row.status === "in_progress" || row.status === "completed" || row.status === "cancelled"
        ? row.status
        : "new",
    kitchen_status:
      row.kitchen_status === "accepted" ||
      row.kitchen_status === "cooking" ||
      row.kitchen_status === "ready" ||
      row.kitchen_status === "handed_out" ||
      row.kitchen_status === "cancelled"
        ? row.kitchen_status
        : "new",
    payment_status:
      row.payment_status === "pending" ||
      row.payment_status === "paid" ||
      row.payment_status === "failed" ||
      row.payment_status === "cancelled" ||
      row.payment_status === "refunded" ||
      row.payment_status === "partially_refunded"
        ? row.payment_status
        : "not_required",
    fiscal_status:
      row.fiscal_status === "pending" ||
      row.fiscal_status === "issued" ||
      row.fiscal_status === "failed" ||
      row.fiscal_status === "refunded"
        ? row.fiscal_status
        : "not_required",
    fulfillment_mode: row.fulfillment_mode === "scheduled" ? "scheduled" : "asap",
    requested_at: nullableString(row.requested_at),
    accepted_at: nullableString(row.accepted_at),
    cooking_started_at: nullableString(row.cooking_started_at),
    ready_at: nullableString(row.ready_at),
    handed_out_at: nullableString(row.handed_out_at),
    cancelled_at: nullableString(row.cancelled_at),
    total: Number(row.total ?? 0),
    items
  };
}

export async function getCustomerOrdersForCustomer(customerId: string, limit = 50) {
  const database = createDatabaseServerClient();
  if (!database) return { orders: [] as CustomerOrder[], error: "База данных не подключена." };

  const { data: ordersData, error: ordersError } = await database
    .from("orders")
    .select("id, created_at, updated_at, display_number, delivery_type, address, comment, status, kitchen_status, payment_status, fiscal_status, fulfillment_mode, requested_at, accepted_at, cooking_started_at, ready_at, handed_out_at, cancelled_at, total")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (ordersError) {
    return {
      orders: [] as CustomerOrder[],
      error: formatMissingTableError(ordersError.message, "orders")
    };
  }

  const orderIds = (ordersData ?? []).map((order) => String(order.id));
  const { data: itemsData, error: itemsError } = orderIds.length
    ? await database
        .from("order_items")
        .select("id, order_id, product_id, product_name, unit_price, quantity, line_total")
        .in("order_id", orderIds)
    : { data: [], error: null };

  if (itemsError) {
    return {
      orders: [] as CustomerOrder[],
      error: formatMissingTableError(itemsError.message, "order_items")
    };
  }

  const itemIds = (itemsData ?? []).map((item) => String(item.id));
  const { data: modifiersData } = itemIds.length
    ? await database
        .from("order_item_modifiers")
        .select("id, order_item_id, modifier_type, ingredient_name")
        .in("order_item_id", itemIds)
    : { data: [] };

  const items = (itemsData ?? []).map((item) => {
    const itemId = String(item.id);
    const modifiers = (modifiersData ?? [])
      .filter((modifier) => String(modifier.order_item_id) === itemId)
      .map((modifier) => ({
        id: String(modifier.id),
        modifier_type: modifier.modifier_type === "add"
          ? "add" as const
          : modifier.modifier_type === "replace"
            ? "replace" as const
            : "remove" as const,
        ingredient_name: String(modifier.ingredient_name ?? "")
      }));
    return {
      id: itemId,
      order_id: String(item.order_id),
      product_id: typeof item.product_id === "string" ? item.product_id : null,
      product_name: String(item.product_name ?? ""),
      unit_price: Number(item.unit_price ?? 0),
      quantity: Number(item.quantity ?? 0),
      line_total: Number(item.line_total ?? 0),
      modifiers
    } satisfies CustomerOrderItem;
  });

  return {
    orders: (ordersData ?? []).map((order) =>
      normalizeOrder(
        order,
        items.filter((item) => item.order_id === String(order.id))
      )
    ),
    error: null as string | null
  };
}

export async function getCustomerOrderStatusesForCustomer(customerId: string, limit = 50) {
  const database = createDatabaseServerClient();
  if (!database) return { orders: [] as CustomerOrderStatus[], error: "База данных не подключена." };

  const { data, error } = await database
    .from("orders")
    .select("id, created_at, updated_at, status, kitchen_status, payment_status, fiscal_status, accepted_at, cooking_started_at, ready_at, handed_out_at, cancelled_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error) {
    return {
      orders: [] as CustomerOrderStatus[],
      error: formatMissingTableError(error.message, "orders")
    };
  }

  return {
    orders: (data ?? []).map((row) => {
      const order = normalizeOrder(row, []);
      return {
        accepted_at: order.accepted_at,
        cancelled_at: order.cancelled_at,
        cooking_started_at: order.cooking_started_at,
        fiscal_status: order.fiscal_status,
        handed_out_at: order.handed_out_at,
        id: order.id,
        kitchen_status: order.kitchen_status,
        payment_status: order.payment_status,
        ready_at: order.ready_at,
        status: order.status,
        updated_at: order.updated_at
      } satisfies CustomerOrderStatus;
    }),
    error: null as string | null
  };
}
