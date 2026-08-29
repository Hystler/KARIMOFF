import "server-only";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerAvatar } from "@/lib/avatar";
import { defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";
import { ensureLoyaltyAccount, type LoyaltyAccount, type LoyaltyTransaction } from "@/lib/loyalty";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getCustomerOrdersForCustomer, type CustomerOrder } from "@/lib/customer-orders";

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
      marketingConsent: false,
      error: null as string | null
    };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return {
      customer,
      account: null as LoyaltyAccount | null,
      avatar: defaultAvatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      marketingConsent: false,
      error: "База данных не подключена."
    };
  }

  const account = await ensureLoyaltyAccount(customer.id);
  const avatarResult = await getCustomerAvatar(customer.id);
  const { data: marketingConsentData } = await database
    .from("legal_consents")
    .select("granted")
    .eq("subject_type", "customer")
    .eq("subject_id", customer.id)
    .eq("consent_type", "marketing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const marketingConsent = marketingConsentData?.granted === true;

  const customerOrders = await getCustomerOrdersForCustomer(customer.id);
  if (customerOrders.error) {
    return {
      customer,
      account,
      avatar: avatarResult.avatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      marketingConsent,
      error: customerOrders.error
    };
  }

  const { data: transactionsData, error: transactionsError } = await database
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
      marketingConsent,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions")
    };
  }

  return {
    customer,
    account,
    avatar: avatarResult.avatar as AvatarConfig,
    marketingConsent,
    orders: customerOrders.orders,
    transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction)),
    error: null as string | null
  };
}
