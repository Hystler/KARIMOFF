import "server-only";

import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";

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
  const database = createDatabaseServerClient();

  if (!database) {
    return null;
  }

  await database.from("loyalty_accounts").upsert({ customer_id: customerId }, { onConflict: "customer_id" });

  const { data } = await database
    .from("loyalty_accounts")
    .select("customer_id, points_balance, total_earned, total_spent")
    .eq("customer_id", customerId)
    .maybeSingle();

  return normalizeAccount(data, customerId);
}

export async function getAdminLoyalty() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data: customersData, error: customersError } = await database
    .from("customers")
    .select("id, created_at, name, phone")
    .order("created_at", { ascending: false });

  if (customersError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(customersError.message, "customers")
    };
  }

  const customerIds = (customersData ?? []).map((customer) => String(customer.id));
  const { data: accountsData, error: accountsError } = customerIds.length
    ? await database
        .from("loyalty_accounts")
        .select("customer_id, points_balance, total_earned, total_spent")
        .in("customer_id", customerIds)
    : { data: [], error: null };

  if (accountsError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(accountsError.message, "loyalty_accounts")
    };
  }

  const accounts = new Map((accountsData ?? []).map((account) => [String(account.customer_id), normalizeAccount(account, String(account.customer_id))]));

  const { data: transactionsData, error: transactionsError } = await database
    .from("loyalty_transactions")
    .select("id, created_at, customer_id, order_id, type, points, description")
    .order("created_at", { ascending: false })
    .limit(100);

  if (transactionsError) {
    return {
      customers: [] as AdminLoyaltyCustomer[],
      transactions: [] as LoyaltyTransaction[],
      notConfigured: false,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions")
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
