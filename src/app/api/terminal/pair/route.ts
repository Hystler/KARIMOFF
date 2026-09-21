import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeEvotorRateLimit } from "@/lib/integrations/evotor/auth";
import { pairTerminal, terminalBridgeReady } from "@/lib/integrations/evotor/terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().regex(/^\d{8}$/),
  deviceKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  label: z.string().trim().min(1).max(120),
  appVersion: z.string().trim().min(1).max(40)
});

export async function POST(request: Request) {
  if (!terminalBridgeReady()) {
    return NextResponse.json({ ok: false, error: "Bridge disabled." }, { status: 503 });
  }
  const rate = await consumeEvotorRateLimit(request, "terminal-pair", 10);
  if (!rate.allowed) {
    return NextResponse.json({ ok: false, error: "Too many attempts." }, {
      status: 429,
      headers: { "retry-after": String(rate.retry_after_seconds) }
    });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const paired = await pairTerminal(parsed.data);
  if (!paired) {
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, token: paired.token, deviceId: paired.deviceId });
}
