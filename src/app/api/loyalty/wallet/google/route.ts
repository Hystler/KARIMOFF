import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard } from "@/lib/loyalty-card";
import { getWalletConfiguration } from "@/lib/wallet/config";
import { createGoogleWalletSaveUrl } from "@/lib/wallet/google";
import { getCurrentConsentState } from "@/lib/legal-consents";
import { LEGAL_VERSION } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
  const consent = await getCurrentConsentState(customer.id, "loyalty_rules");
  if (consent?.granted !== true || consent.document_version !== LEGAL_VERSION) redirect("/profile/loyalty");
  if (!getWalletConfiguration().google) return new Response("Not found", { status: 404 });
  const [card, account] = await Promise.all([
    ensureLoyaltyCard(customer.id),
    ensureLoyaltyAccount(customer.id)
  ]);
  redirect(createGoogleWalletSaveUrl({
    card,
    customerName: customer.name,
    pointsBalance: account?.points_balance ?? 0
  }));
}
