import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerOrderStatusesForCustomer } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const result = await getCustomerOrderStatusesForCustomer(customer.id);
  if (result.error) {
    return NextResponse.json({ ok: false, error: "orders_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return NextResponse.json({ ok: true, orders: result.orders }, {
    headers: { "Cache-Control": "no-store" }
  });
}
