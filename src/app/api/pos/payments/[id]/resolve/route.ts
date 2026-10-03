import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getEvotorPosPaymentStatus, resolveUnknownEvotorPosPayment } from "@/lib/integrations/evotor/pos-payments";
import { canStaffAccessOrderLocation } from "@/lib/order-flow/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  resolution: z.enum(["paid", "cancelled"]),
  receiptReference: z.string().trim().min(1).max(128).optional()
});
const idSchema = z.string().uuid();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
  if (!["owner", "admin", "manager"].includes(staff.role)
    && payment.createdByStaffId !== staff.id) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Неверные данные подтверждения." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Неверные данные подтверждения." }, { status: 400 });
  if (parsed.data.resolution === "paid" && !parsed.data.receiptReference) {
    return NextResponse.json({ ok: false, error: "Укажите номер или идентификатор фискального чека." }, { status: 400 });
  }

  const resolved = await resolveUnknownEvotorPosPayment({
    intentId: id,
    staffId: staff.id,
    ...parsed.data
  });
  if (!resolved) return NextResponse.json({ ok: false, error: "Результат не подтверждён или уже изменился. Проверьте оплату и чек на кассе, не повторяйте оплату." }, { status: 409 });
  if (parsed.data.resolution === "paid") {
    revalidatePath("/kitchen");
    revalidatePath("/admin/kitchen");
    revalidatePath("/admin/orders");
    revalidatePath("/display");
  }
  return NextResponse.json({ ok: true, status: parsed.data.resolution });
}
