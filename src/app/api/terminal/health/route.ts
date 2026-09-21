import { NextResponse } from "next/server";
import { terminalBridgeReady } from "@/lib/integrations/evotor/terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    bridgeEnabled: terminalBridgeReady(),
    mode: "read-only"
  });
}
