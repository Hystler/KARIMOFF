import "server-only";

import { defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";
import { normalizeAvatar } from "@/lib/avatar";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import type { CustomerOrder, CustomerOrderItem } from "@/lib/customer-orders";
import type { LoyaltyAccount, LoyaltyTransaction } from "@/lib/loyalty";
import type { UserIdentityView } from "@/lib/auth/social/identity";

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
  identities: UserIdentityView[];
};

export type AdminCustomerDetail = AdminCustomerListItem & {
  avatar_settings: AvatarConfig;
  account: LoyaltyAccount | null;
  orders: CustomerOrder[];
  transactions: LoyaltyTransaction[];
};

function normalizeCustomer(row: Record<string, unknown>): Omit<AdminCustomerListItem, "avatar" | "points_balance" | "order_count" | "order_total" | "identities"> {
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
    updated_at: String(row.updated_at ?? row.created_at),
    display_number: typeof row.display_number === "string" ? row.display_number : String(row.id).slice(0, 8),
    delivery_type: row.delivery_type === "delivery" ? "delivery" : "pickup",
    address: typeof row.address === "string" ? row.address : null,
    comment: typeof row.comment === "string" ? row.comment : null,
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
    requested_at: typeof row.requested_at === "string" ? row.requested_at : null,
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : null,
    cooking_started_at: typeof row.cooking_started_at === "string" ? row.cooking_started_at : null,
    ready_at: typeof row.ready_at === "string" ? row.ready_at : null,
    handed_out_at: typeof row.handed_out_at === "string" ? row.handed_out_at : null,
    cancelled_at: typeof row.cancelled_at === "string" ? row.cancelled_at : null,
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
    line_total: Number(row.line_total ?? 0),
    modifiers: []
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

function normalizeIdentity(row: Record<string, unknown>): UserIdentityView {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    id: String(row.id),
    provider: row.provider as UserIdentityView["provider"],
    providerUserId: String(row.provider_user_id),
    username: typeof row.username === "string" ? row.username : null,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    phoneVerified: Boolean(row.phone_verified),
    givenName: typeof metadata.givenName === "string" ? metadata.givenName : null,
    familyName: typeof metadata.familyName === "string" ? metadata.familyName : null,
    linkedAt: String(row.linked_at),
    lastLoginAt: typeof row.last_login_at === "string" ? row.last_login_at : null
  };
}

export async function getAdminCustomers() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customersData, error: customersError } = await database
    .from("customers")
    .select("id, created_at, last_login_at, name, phone, birthday")
    .order("created_at", { ascending: false });

  if (customersError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(customersError.message, "customers")
    };
  }

  const customers = (customersData ?? []).map((customer) => normalizeCustomer(customer));
  const customerIds = customers.map((customer) => customer.id);

  const [{ data: avatarsData, error: avatarsError }, { data: accountsData, error: accountsError }, { data: ordersData, error: ordersError }, { data: identitiesData, error: identitiesError }] =
    customerIds.length
      ? await Promise.all([
          database.from("customer_avatars").select("customer_id, base, eyes, mouth, accessory, clothes, background").in("customer_id", customerIds),
          database.from("loyalty_accounts").select("customer_id, points_balance, total_earned, total_spent").in("customer_id", customerIds),
          database.from("orders").select("customer_id, total").in("customer_id", customerIds),
          database.from("user_identities").select("id, user_id, provider, provider_user_id, username, display_name, avatar_url, email, phone, phone_verified, metadata, linked_at, last_login_at").in("user_id", customerIds).in("provider", ["phone", "telegram", "max"])
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null }
        ];

  if (avatarsError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(avatarsError.message, "customer_avatars")
    };
  }

  if (accountsError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(accountsError.message, "loyalty_accounts")
    };
  }

  if (ordersError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders")
    };
  }
  if (identitiesError) {
    return {
      customers: [] as AdminCustomerListItem[],
      notConfigured: false,
      error: formatMissingTableError(identitiesError.message, "user_identities")
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
        order_total: stats?.total ?? 0,
        identities: (identitiesData ?? [])
          .filter((identity) => String(identity.user_id) === customer.id)
          .map((identity) => normalizeIdentity(identity))
      };
    }),
    notConfigured: false,
    error: null as string | null
  };
}

export async function getAdminCustomerById(id: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customerData, error: customerError } = await database
    .from("customers")
    .select("id, created_at, last_login_at, name, phone, birthday")
    .eq("id", id)
    .maybeSingle();

  if (customerError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(customerError.message, "customers")
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
  const [{ data: avatarData, error: avatarError }, { data: accountData, error: accountError }, { data: ordersData, error: ordersError }, { data: transactionsData, error: transactionsError }, { data: identitiesData, error: identitiesError }] =
    await Promise.all([
      database.from("customer_avatars").select("base, eyes, mouth, accessory, clothes, background").eq("customer_id", id).maybeSingle(),
      database.from("loyalty_accounts").select("customer_id, points_balance, total_earned, total_spent").eq("customer_id", id).maybeSingle(),
      database
        .from("orders")
        .select("id, created_at, updated_at, display_number, delivery_type, address, comment, status, kitchen_status, payment_status, fiscal_status, fulfillment_mode, requested_at, accepted_at, cooking_started_at, ready_at, handed_out_at, cancelled_at, total")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      database
        .from("loyalty_transactions")
        .select("id, created_at, customer_id, order_id, type, points, description")
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      database
        .from("user_identities")
        .select("id, provider, provider_user_id, username, display_name, avatar_url, email, phone, phone_verified, metadata, linked_at, last_login_at")
        .eq("user_id", id)
        .in("provider", ["phone", "telegram", "max"])
        .order("linked_at", { ascending: true })
    ]);

  if (avatarError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(avatarError.message, "customer_avatars")
    };
  }

  if (accountError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(accountError.message, "loyalty_accounts")
    };
  }

  if (ordersError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders")
    };
  }

  if (transactionsError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions")
    };
  }
  if (identitiesError) {
    return {
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(identitiesError.message, "user_identities")
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
      customer: null as AdminCustomerDetail | null,
      notConfigured: false,
      error: formatMissingTableError(itemsError.message, "order_items")
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
      identities: (identitiesData ?? []).map((identity) => normalizeIdentity(identity)),
      orders,
      transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction))
    },
    notConfigured: false,
    error: null as string | null
  };
}
