import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  modifiers: AdminOrderItemModifier[];
};

export type AdminOrderItemModifier = {
  id: string;
  modifier_type: "remove" | "add";
  ingredient_name: string;
  quantity: number;
  unit: string;
  line_price_delta: number;
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
  payment_status: "not_required" | "pending" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
  fiscal_status: "not_required" | "pending" | "issued" | "failed" | "refunded";
  fulfillment_mode: "asap" | "scheduled";
  requested_at: string | null;
  kitchen_started_at: string | null;
  kitchen_completed_at: string | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  total: number;
  items: AdminOrderItem[];
};

function normalizeOrder(
  row: Record<string, unknown>,
  items: AdminOrderItem[],
  staffNames: Map<string, string>
): AdminOrder {
  const assignedStaffId = row.assigned_staff_id ? String(row.assigned_staff_id) : null;
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
    requested_at: typeof row.requested_at === "string" ? row.requested_at : null,
    kitchen_started_at: typeof row.kitchen_started_at === "string" ? row.kitchen_started_at : null,
    kitchen_completed_at: typeof row.kitchen_completed_at === "string" ? row.kitchen_completed_at : null,
    assigned_staff_id: assignedStaffId,
    assigned_staff_name: assignedStaffId ? staffNames.get(assignedStaffId) ?? null : null,
    total: Number(row.total ?? 0),
    items
  };
}

function normalizeItem(
  row: Record<string, unknown>,
  modifiers: AdminOrderItemModifier[]
): AdminOrderItem {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    product_id: row.product_id ? String(row.product_id) : null,
    product_name: String(row.product_name ?? ""),
    unit_price: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    line_total: Number(row.line_total ?? 0),
    modifiers
  };
}

function normalizeModifier(row: Record<string, unknown>): AdminOrderItemModifier {
  return {
    id: String(row.id),
    modifier_type: row.modifier_type === "add" ? "add" : "remove",
    ingredient_name: String(row.ingredient_name ?? ""),
    quantity: Number(row.quantity ?? 0),
    unit: String(row.unit ?? ""),
    line_price_delta: Number(row.line_price_delta ?? 0)
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
    .select("id, created_at, customer_name, customer_phone, delivery_type, address, comment, status, payment_status, fiscal_status, fulfillment_mode, requested_at, kitchen_started_at, kitchen_completed_at, assigned_staff_id, total")
    .order("created_at", { ascending: false });

  if (ordersError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders", "supabase/orders.sql")
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

  const [{ data: itemsData, error: itemsError }, { data: staffData }] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("id, order_id, product_id, product_name, unit_price, quantity, line_total")
        .in("order_id", orderIds),
      supabase.from("staff_users").select("id, name")
    ]);

  if (itemsError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: formatMissingTableError(itemsError.message, "order_items", "supabase/orders.sql")
    };
  }

  const itemIds = (itemsData ?? []).map((item) => String(item.id));
  let resolvedModifiers: Record<string, unknown>[] = [];

  if (itemIds.length) {
    const { data } = await supabase
      .from("order_item_modifiers")
      .select("id, order_item_id, modifier_type, ingredient_name, quantity, unit, line_price_delta")
      .in("order_item_id", itemIds);
    resolvedModifiers = data ?? [];
  }

  const modifiersByItem = new Map<string, AdminOrderItemModifier[]>();
  for (const modifierRow of resolvedModifiers) {
    const itemId = String(modifierRow.order_item_id);
    modifiersByItem.set(itemId, [
      ...(modifiersByItem.get(itemId) ?? []),
      normalizeModifier(modifierRow)
    ]);
  }

  const staffNames = new Map((staffData ?? []).map((staff) => [String(staff.id), String(staff.name)]));
  const items = (itemsData ?? []).map((item) =>
    normalizeItem(item, modifiersByItem.get(String(item.id)) ?? [])
  );
  const orders = (ordersData ?? []).map((order) =>
    normalizeOrder(
      order,
      items.filter((item) => item.order_id === String(order.id)),
      staffNames
    )
  );

  return {
    orders,
    notConfigured: false,
    error: null as string | null
  };
}
