import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard } from "@/lib/loyalty-card";
import { createAppleWalletPass } from "@/lib/wallet/apple";
import { getWalletConfiguration } from "@/lib/wallet/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) return new Response("Unauthorized", { status: 401 });
  if (!getWalletConfiguration().apple) return new Response("Not found", { status: 404 });
  const [card, account] = await Promise.all([
    ensureLoyaltyCard(customer.id),
    ensureLoyaltyAccount(customer.id)
  ]);
  const pass = await createAppleWalletPass({
    card,
    customerName: customer.name,
    pointsBalance: account?.points_balance ?? 0
  });
  return new Response(new Uint8Array(pass), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="karimoff-${card.publicCode}.pkpass"`,
      "Content-Type": "application/vnd.apple.pkpass",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
