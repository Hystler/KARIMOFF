import { NextRequest, NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerPaymentStatus } from "@/lib/payments/yookassa/repository";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const customer = await getCurrentCustomer();
  if (!customer) return noStore({ ok: false, error: "unauthorized" }, 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return noStore({ ok: false, error: "not_found" }, 404);

  const payment = await getCustomerPaymentStatus(id, customer.id);
  if (!payment) return noStore({ ok: false, error: "not_found" }, 404);
  return noStore({
    ok: true,
    payment: {
      fiscalStatus: payment.fiscalStatus,
      orderNumber: payment.displayNumber,
      status: payment.paymentStatus
    }
  });
}
