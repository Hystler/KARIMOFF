import "server-only";

import { defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";
import { normalizeAvatar } from "@/lib/avatar";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CustomerOrder, CustomerOrderItem } from "@/lib/customer-data";
import type { LoyaltyAccount, LoyaltyTransaction } from "@/lib/loyalty";

export type AdminCustomerListItem = {
  id: string;
  created_at: string;
  last_login_at: string | null;
  name: string;
  phone: string;
  birthday: string | null;
  avatar: AvatarConfig;
  points_balance: number;
  order_count: number;
  order_total: number;
};

export type AdminCustomerDetail = AdminCustomerListItem & {
  avatar_settings: AvatarConfig;
  account: LoyaltyAccount | null;
  orders: CustomerOrder[];
  transactions: LoyaltyTransaction[];
};

function normalizeCustomer(row: Record<string, unknown>): Omit<AdminCustomerListItem, "avatar" | "points_balance" | "order_count" | "order_total"> {
  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    last_login_at: typeof row.last_login_at === "string" ? row.last_login_at : null,
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    birthday: typeof row.birthday === "string" ? row.birthday : null
  };
}

function normalizeAccount(row: Record<string, unknown> | null | undefined, customerId: string): LoyaltyAccount | null {
  if (!row) {
    return null;
  }

  return {
    customer_id: String(row.customer_id ?? customerId),
    points_balance: Number(row.points_balance ?? 0),
    total_earned: Number(row.total_earned ?? 0),
    total_spent: Number(row.total_spent ?? 0)
  };
}

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

export async function getAdminCustomers() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customersData, error: customersError } = await supabase
    .from("customers")
    .select("id, created_at, last_login_at, name, phone, birthday")
    .order("created_at", { ascending: false });

  if (customersError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(customersError.message, "customers", "supabase/customers.sql")
    };
  }

  const customers = (customersData ?? []).map((customer) => normalizeCustomer(customer));
  const customerIds = customers.map((customer) => customer.id);

  const [{ data: avatarsData, error: avatarsError }, { data: accountsData, error: accountsError }, { data: ordersData, error: ordersError }] =
    customerIds.length
      ? await Promise.all([
          supabase.from("customer_avatars").select("customer_id, base, eyes, mouth, accessory, clothes, background").in("customer_id", customerIds),
          supabase.from("loyalty_accounts").select("customer_id, points_balance, total_earned, total_spent").in("customer_id", customerIds),
          supabase.from("orders").select("customer_id, total").in("customer_id", customerIds)
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null }
        ];

  if (avatarsError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(avatarsError.message, "customer_avatars", "supabase/avatar.sql")
    };
  }

  if (accountsError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(accountsError.message, "loyalty_accounts", "supabase/loyalty.sql")
    };
  }

  if (ordersError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders", "supabase/orders.sql")
    };
  }

  const avatars = new Map((avatarsData ?? []).map((avatar) => [String(avatar.customer_id), normalizeAvatar(avatar)]));
  const accounts = new Map((accountsData ?? []).map((account) => [String(account.customer_id), normalizeAccount(account, String(account.customer_id))]));
  const orderStats = new Map<string, { count: number; total: number }>();

  for (const order of ordersData ?? []) {
    const customerId = String(order.customer_id ?? "");

    if (!customerId) {
      continue;
    }

    const current = orderStats.get(customerId) ?? { count: 0, total: 0 };
    orderStats.set(customerId, {
      count: current.count + 1,
      total: current.total + Number(order.total ?? 0)
    });
  }

  return {
    customers: customers.map((customer) => {
      const account = accounts.get(customer.id);
      const stats = orderStats.get(customer.id);

      return {
        ...customer,
        avatar: avatars.get(customer.id) ?? defaultAvatar,
        points_balance: account?.points_balance ?? 0,
        order_count: stats?.count ?? 0,
        order_total: stats?.total ?? 0
      };
    }),
    notConfigured: false,
    error: null as string | null
  };
}

export async function getAdminCustomerById(id: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customerData, error: customerError } = await supabase
    .from("customers")
    .select("id, created_at, last_login_at, name, phone, birthday")
    .eq("id", id)
    .maybeSingle();

  if (customerError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(customerError.message, "customers", "supabase/customers.sql")
    };
  }

  if (!customerData) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: null as string | null
    };
  }

  const customer = normalizeCustomer(customerData);
  const [{ data: avatarData, error: avatarError }, { data: accountData, error: accountError }, { data: ordersData, error: ordersError }, { data: transactionsData, error: transactionsError }] =
    await Promise.all([
      supabase.from("customer_avatars").select("base, eyes, mouth, accessory, clothes, background").eq("customer_id", id).maybeSingle(),
      supabase.from("loyalty_accounts").select("customer_id, points_balance, total_earned, total_spent").eq("customer_id", id).maybeSingle(),
      supabase
        .from("orders")
        .select("id, created_at, delivery_type, address, comment, status, total")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("loyalty_transactions")
        .select("id, created_at, customer_id, order_id, type, points, description")
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(100)
    ]);

  if (avatarError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(avatarError.message, "customer_avatars", "supabase/avatar.sql")
    };
  }

  if (accountError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(accountError.message, "loyalty_accounts", "supabase/loyalty.sql")
    };
  }

  if (ordersError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders", "supabase/orders.sql")
    };
  }

  if (transactionsError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions", "supabase/loyalty.sql")
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
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(itemsError.message, "order_items", "supabase/orders.sql")
    };
  }

  const avatar = normalizeAvatar(avatarData);
  const account = normalizeAccount(accountData, id);
  const items = (itemsData ?? []).map((item) => normalizeOrderItem(item));
  const orders = (ordersData ?? []).map((order) =>
    normalizeOrder(
      order,
      items.filter((item) => item.order_id === String(order.id))
    )
  );

  return {
    customer: {
      ...customer,
      avatar,
      avatar_settings: avatar,
      account,
      points_balance: account?.points_balance ?? 0,
      order_count: orders.length,
      order_total: orders.reduce((sum, order) => sum + order.total, 0),
      orders,
      transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction))
    },
    notConfigured: false,
    error: null as string | null
  };
}
