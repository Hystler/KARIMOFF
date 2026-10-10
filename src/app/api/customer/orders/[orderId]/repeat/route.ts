import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerRepeatOrder } from "@/lib/customer-repeat-order";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Войдите, чтобы повторить заказ." }, { status: 401, headers });
  const { orderId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ ok: false, error: "Заказ не найден." }, { status: 404, headers });
  }
  try {
    const result = await getCustomerRepeatOrder(customer.id, orderId);
    if (!result) return NextResponse.json({ ok: false, error: "Заказ не найден или ещё не оплачен." }, { status: 404, headers });
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "Не удалось проверить состав заказа. Попробуйте ещё раз." }, { status: 503, headers });
  }
}
