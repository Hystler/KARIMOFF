import { getProductEdition } from "@/lib/product-edition";
import { NextResponse } from "next/server";
import { authenticateTerminal, nextTerminalPreview } from "@/lib/integrations/evotor/terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const device = await authenticateTerminal(request);
  if (!device) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // authenticateTerminal records the heartbeat; never dequeue orders in the cabinet.
  if (getProductEdition() === "analytics") return NextResponse.json({ ok: true, job: null });
  const job = await nextTerminalPreview(device.id);
  return NextResponse.json({ ok: true, job });
}
