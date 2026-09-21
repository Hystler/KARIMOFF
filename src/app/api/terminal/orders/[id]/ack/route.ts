import { NextResponse } from "next/server";
import { z } from "zod";
import { acknowledgeTerminalPreview, authenticateTerminal } from "@/lib/integrations/evotor/terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateTerminal(request);
  if (!device) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid job." }, { status: 400 });
  const acknowledged = await acknowledgeTerminalPreview(device.id, parsed.data);
  return NextResponse.json({ ok: acknowledged }, { status: acknowledged ? 200 : 409 });
}
