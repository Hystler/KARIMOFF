import { NextResponse } from "next/server";
import { authenticateTerminal, nextTerminalPreview } from "@/lib/integrations/evotor/terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const device = await authenticateTerminal(request);
  if (!device) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const job = await nextTerminalPreview(device.id);
  return NextResponse.json({ ok: true, job });
}
