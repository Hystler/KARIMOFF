import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard } from "@/lib/loyalty-card";
import { getWalletConfiguration } from "@/lib/wallet/config";
import { createGoogleWalletSaveUrl } from "@/lib/wallet/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
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
