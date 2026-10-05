import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateTerminal } from "@/lib/integrations/evotor/terminal-bridge";
import { saveEvotorLocalReceipt } from "@/lib/integrations/evotor/pos-payments";

export const runtime = "nodejs";
const schema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  localReceiptUuid: z.string().uuid(),
  paymentSystemId: z.string().trim().min(1).max(255),
  openedAt: z.iso.datetime()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateTerminal(request);
  if (!device) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const saved = await saveEvotorLocalReceipt({ deviceId: device.id, intentId: id, ...parsed.data });
  return NextResponse.json({ ok: saved }, { status: saved ? 200 : 409 });
}
