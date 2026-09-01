import { z } from "zod";
import { getCurrentStaff } from "@/lib/admin-auth";
import { resolveLoyaltyCardPublicCode, resolveLoyaltyCardToken } from "@/lib/loyalty-card";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ value: z.string().trim().min(12).max(180) });

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "Телефон подтверждён";
  return `••• ${digits.slice(-4)}`;
}

export async function POST(request: Request) {
  if (!isAllowedSameOriginRequest(request)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin", "manager", "cashier"].includes(staff.role)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_card" }, { status: 400 });
  }
  const value = parsed.data.value;
  const resolved = value.startsWith("KARIMOFF:L1:")
    ? await resolveLoyaltyCardToken(value, true)
    : await resolveLoyaltyCardPublicCode(value, true);
  if (!resolved) {
    return Response.json({ ok: false, error: "card_not_found" }, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" }
    });
  }
  return Response.json({
    ok: true,
    customer: {
      id: resolved.customer.id,
      name: resolved.customer.name,
      phoneMasked: maskPhone(resolved.customer.phone),
      pointsBalance: resolved.customer.pointsBalance,
      cardCode: resolved.card.publicCode
    }
  }, { headers: { "Cache-Control": "private, no-store" } });
}
