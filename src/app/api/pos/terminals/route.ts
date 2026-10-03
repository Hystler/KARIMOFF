import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { getTerminalBridgeDevices } from "@/lib/integrations/evotor/terminal-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin", "manager", "cashier"].includes(staff.role)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const locations = await getAccessibleOrderLocations(staff);
  const devices = await getTerminalBridgeDevices(locations.map((location) => location.id));
  return NextResponse.json({ ok: true, devices });
}
