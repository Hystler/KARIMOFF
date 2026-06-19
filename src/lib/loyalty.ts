import "server-only";

import { getSiteSettings } from "@/lib/settings";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoyaltyAccount = {
  customer_id: string;
  points_balance: number;
  total_earned: number;
  total_spent: number;
};

export type LoyaltyTransaction = {
  id: string;
  created_at: string;
  customer_id: string;
  order_id: string | null;
  type: "earn" | "spend" | "adjust";
  points: number;
  description: string | null;
};

export type AdminLoyaltyCustomer = {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  points_balance: number;
  total_earned: number;
  total_spent: number;
};

function normalizeAccount(row: Record<string, unknown> | null | undefined, customerId: string): LoyaltyAccount {
  return {
    customer_id: String(row?.customer_id ?? customerId),
    points_balance: Number(row?.points_balance ?? 0),
    total_earned: Number(row?.total_earned ?? 0),
    total_spent: Number(row?.total_spent ?? 0)
  };
}

function normalizeTransaction(row: Record<string, unknown>): LoyaltyTransaction {
  const type = row.type === "spend" || row.type === "adjust" ? row.type : "earn";

  return {
    id: String(row.id),
    created_at: String(row.created_at),
    customer_id: String(row.customer_id),
    order_id: typeof row.order_id === "string" ? row.order_id : null,
    type,
    points: Number(row.points ?? 0),
    description: typeof row.description === "string" ? row.description : null
  };
}

export async function ensureLoyaltyAccount(customerId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  await supabase.from("loyalty_accounts").upsert({ customer_id: customerId }, { onConflict: "customer_id" });

  const { data } = await supabase
    .from("loyalty_accounts")
    .select("customer_id, points_balance, total_earned, total_spent")
    .eq("customer_id", customerId)
    .maybeSingle();

  return normalizeAccount(data, customerId);
}

export async function awardLoyaltyForCompletedOrder(orderId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, customer_id, total")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order?.customer_id) {
    return;
  }

  const settings = await getSiteSettings();

  if (!settings.loyalty_enabled) {
    return;
  }

  const points = Math.max(0, Math.round(Number(order.total ?? 0) * settings.loyalty_percent) / 100);

  if (points <= 0) {
    return;
  }

  const customerId = String(order.customer_id);
  const { data: existingTransaction } = await supabase
    .from("loyalty_transactions")
    .select("id")
    .eq("order_id", orderId)
    .eq("type", "earn")
    .maybeSingle();

  if (existingTransaction) {
    return;
  }

  const account = await ensureLoyaltyAccount(customerId);

  const { error: transactionError } = await supabase.from("loyalty_transactions").insert({
    customer_id: customerId,
    order_id: orderId,
    type: "earn",
    points,
    description: `Начисление за заказ ${orderId}`
  });

  if (transactionError) {
    return;
  }

  await supabase
    .from("loyalty_accounts")
    .update({
      points_balance: (account?.points_balance ?? 0) + points,
      total_earned: (account?.total_earned ?? 0) + points
    })
    .eq("customer_id", customerId);
}

export async function getAdminLoyalty() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customersData, error: customersError } = await supabase
    .from("customers")
    .select("id, created_at, name, phone")
    .order("created_at", { ascending: false });

  if (customersError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(customersError.message, "customers", "supabase/customers.sql")
    };
  }

  const customerIds = (customersData ?? []).map((customer) => String(customer.id));
  const { data: accountsData, error: accountsError } = customerIds.length
    ? await supabase
        .from("loyalty_accounts")
        .select("customer_id, points_balance, total_earned, total_spent")
        .in("customer_id", customerIds)
    : { data: [], error: null };

  if (accountsError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(accountsError.message, "loyalty_accounts", "supabase/loyalty.sql")
    };
  }

  const accounts = new Map((accountsData ?? []).map((account) => [String(account.customer_id), normalizeAccount(account, String(account.customer_id))]));

  const { data: transactionsData, error: transactionsError } = await supabase
    .from("loyalty_transactions")
    .select("id, created_at, customer_id, order_id, type, points, description")
    .order("created_at", { ascending: false })
    .limit(100);

  if (transactionsError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions", "supabase/loyalty.sql")
    };
  }

  return {
    customers: (customersData ?? []).map((customer) => {
      const account = accounts.get(String(customer.id));

      return {
        id: String(customer.id),
        created_at: String(customer.created_at),
        name: String(customer.name ?? ""),
        phone: String(customer.phone ?? ""),
        points_balance: account?.points_balance ?? 0,
        total_earned: account?.total_earned ?? 0,
        total_spent: account?.total_spent ?? 0
      };
    }),
    transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction)),
    notConfigured: false,
    error: null as string | null
  };
}
