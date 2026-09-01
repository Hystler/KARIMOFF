import QRCode from "qrcode";
import type { NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { createLoyaltyCardToken, ensureLoyaltyCard } from "@/lib/loyalty-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const customer = await getCurrentCustomer();
  if (!customer) return new Response("Unauthorized", { status: 401 });
  const card = await ensureLoyaltyCard(customer.id);
  if (card.status !== "active") return new Response("Card unavailable", { status: 409 });
  const svg = await QRCode.toString(createLoyaltyCardToken(card), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 520,
    color: { dark: "#111114", light: "#FFFFFF" }
  });
  const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(svg, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${disposition}; filename="karimoff-${card.publicCode}.svg"`,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
