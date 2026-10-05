import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authenticateTerminal } from "@/lib/integrations/evotor/terminal-bridge";
import { recordEvotorTerminalPaymentResult } from "@/lib/integrations/evotor/pos-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const resultSchema = z.object({
  status: z.enum(["paid", "failed", "cancelled", "unknown"]),
  receiptReference: z.string().trim().min(1).max(128).optional().nullable(),
  fiscal: z.object({
    storageNumber: z.string().trim().min(1).max(32),
    documentNumber: z.string().trim().min(1).max(32),
    sign: z.string().trim().min(1).max(32),
    fiscalizedAt: z.iso.datetime(),
    receiptNumber: z.string().trim().max(80).optional(),
    total: z.number().positive().optional(),
    paymentIdentifier: z.string().trim().max(128).optional(),
    documentType: z.literal("SELL")
  }).optional().nullable(),
  paymentEvidence: z.object({
    receiptClosed: z.literal(true),
    paymentType: z.literal("ELECTRON"),
    total: z.number().positive(),
    paymentIdentifier: z.string().trim().min(1).max(128),
    paymentSystemId: z.string().trim().min(1).max(255)
  }).optional().nullable(),
  details: z.string().trim().max(300).optional().nullable(),
  safeBeforePayment: z.boolean().optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateTerminal(request);
  if (!device) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid payment intent." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid result payload." }, { status: 400 });
  }
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid result payload." }, { status: 400 });

  const result = await recordEvotorTerminalPaymentResult({
    deviceId: device.id,
    intentId: id,
    ...parsed.data
  });
  if (!result.accepted) return NextResponse.json({ ok: false, status: result.status }, { status: 409 });
  if (result.status === "paid") {
    revalidatePath("/kitchen");
    revalidatePath("/admin/kitchen");
    revalidatePath("/admin/orders");
    revalidatePath("/display");
  }
  return NextResponse.json({ ok: true, status: result.status });
}
