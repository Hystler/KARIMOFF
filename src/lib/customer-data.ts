import "server-only";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerAvatar } from "@/lib/avatar";
import { defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";
import { ensureLoyaltyAccount, type LoyaltyAccount, type LoyaltyTransaction } from "@/lib/loyalty";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomerOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type CustomerOrder = {
  id: string;
  created_at: string;
  delivery_type: "pickup" | "delivery";
  address: string | null;
  comment: string | null;
  status: "new" | "in_progress" | "completed" | "cancelled";
  total: number;
  items: CustomerOrderItem[];
};

function normalizeOrder(row: Record<string, unknown>, items: CustomerOrderItem[]): CustomerOrder {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
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

function normalizeOrderItem(row: Record<string, unknown>): CustomerOrderItem {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    product_id: typeof row.product_id === "string" ? row.product_id : null,
    product_name: String(row.product_name ?? ""),
    unit_price: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    line_total: Number(row.line_total ?? 0)
  };
}

function normalizeTransaction(row: Record<string, unknown>): LoyaltyTransaction {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    customer_id: String(row.customer_id),
    order_id: typeof row.order_id === "string" ? row.order_id : null,
    type: row.type === "spend" || row.type === "adjust" ? row.type : "earn",
    points: Number(row.points ?? 0),
    description: typeof row.description === "string" ? row.description : null
  };
}

export async function getCustomerProfileData() {
  const customer = await getCurrentCustomer();

  if (!customer) {
    return {
      customer: null,
      account: null as LoyaltyAccount | null,
      avatar: defaultAvatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      error: null as string | null
    };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      customer,
      account: null as LoyaltyAccount | null,
      avatar: defaultAvatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      error: "Supabase не подключён."
    };
  }

  const account = await ensureLoyaltyAccount(customer.id);
  const avatarResult = await getCustomerAvatar(customer.id);

  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id, created_at, delivery_type, address, comment, status, total")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (ordersError) {
    return {
      customer,
      account,
      avatar: avatarResult.avatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      error: formatMissingTableError(ordersError.message, "orders", "supabase/orders.sql")
    };
  }

  const orderIds = (ordersData ?? []).map((order) => String(order.id));
  const { data: itemsData, error: itemsError } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("id, order_id, product_id, product_name, unit_price, quantity, line_total")
        .in("order_id", orderIds)
    : { data: [], error: null };

  if (itemsError) {
    return {
      customer,
      account,
      avatar: avatarResult.avatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      error: formatMissingTableError(itemsError.message, "order_items", "supabase/orders.sql")
    };
  }

  const { data: transactionsData, error: transactionsError } = await supabase
    .from("loyalty_transactions")
    .select("id, created_at, customer_id, order_id, type, points, description")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (transactionsError) {
    return {
      customer,
      account,
      avatar: avatarResult.avatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions", "supabase/loyalty.sql")
    };
  }

  const items = (itemsData ?? []).map((item) => normalizeOrderItem(item));

  return {
    customer,
    account,
    avatar: avatarResult.avatar as AvatarConfig,
    orders: (ordersData ?? []).map((order) =>
      normalizeOrder(
        order,
        items.filter((item) => item.order_id === String(order.id))
      )
    ),
    transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction)),
    error: null as string | null
  };
}
