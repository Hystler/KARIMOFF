import "server-only";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCurrentConsentState } from "@/lib/legal-consents";
import { getCustomerAvatar } from "@/lib/avatar";
import { defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";
import { getLoyaltyAccount, type LoyaltyAccount, type LoyaltyTransaction } from "@/lib/loyalty";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getCustomerOrdersForCustomer, type CustomerOrder } from "@/lib/customer-orders";
import { LEGAL_VERSION } from "@/lib/legal";

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
      loyaltyJoined: false,
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
      loyaltyJoined: false,
      error: "База данных не подключена."
    };
  }

  const account = await getLoyaltyAccount(customer.id);
  const loyaltyConsent = await getCurrentConsentState(customer.id, "loyalty_rules");
  const loyaltyJoined = loyaltyConsent?.granted === true && loyaltyConsent.document_version === LEGAL_VERSION;
  const avatarResult = await getCustomerAvatar(customer.id);
  const marketingConsentData = await getCurrentConsentState(customer.id, "marketing");
  const marketingConsent = marketingConsentData?.granted === true
    && marketingConsentData.document_version === LEGAL_VERSION;

  const customerOrders = await getCustomerOrdersForCustomer(customer.id);
  if (customerOrders.error) {
    return {
      customer,
      account,
      avatar: avatarResult.avatar,
      orders: [] as CustomerOrder[],
      transactions: [] as LoyaltyTransaction[],
      marketingConsent,
      loyaltyJoined,
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
      loyaltyJoined,
      error: formatMissingTableError(transactionsError.message, "loyalty_transactions")
    };
  }

  return {
    customer,
    account,
    avatar: avatarResult.avatar as AvatarConfig,
    marketingConsent,
    loyaltyJoined,
    orders: customerOrders.orders,
    transactions: (transactionsData ?? []).map((transaction) => normalizeTransaction(transaction)),
    error: null as string | null
  };
}
