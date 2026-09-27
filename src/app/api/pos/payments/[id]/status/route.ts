import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentStaff } from "@/lib/admin-auth";
import { canStaffAccessOrderLocation } from "@/lib/order-flow/access";
import { getEvotorPosPaymentStatus } from "@/lib/integrations/evotor/pos-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin", "manager", "cashier"].includes(staff.role)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ ok: false }, { status: 400 });
  const payment = await getEvotorPosPaymentStatus(id);
  if (!payment || !await canStaffAccessOrderLocation(staff, payment.locationId)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    intentId: payment.intentId,
    orderId: payment.orderId,
    displayNumber: payment.displayNumber,
    status: payment.status,
    amount: payment.amount,
    result: payment.result
  });
}
