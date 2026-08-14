import { NextResponse } from "next/server";
import { z } from "zod";
import { queueDueEvotorSyncs } from "@/lib/integrations/evotor/repository";
import { processPendingEvotorSyncEvents } from "@/lib/integrations/evotor/sync";
import { verifyInternalBearer } from "@/lib/security/internal-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  mode: z.enum(["incremental", "reconciliation"]).default("incremental"),
  limit: z.coerce.number().int().min(1).max(10).default(3)
});

export async function POST(request: Request) {
  if (process.env.EVOTOR_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "Integration is disabled." }, { status: 503 });
  }
  if (!verifyInternalBearer(request, process.env.EVOTOR_SYNC_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = requestSchema.safeParse({
    mode: url.searchParams.get("mode") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid sync parameters." }, { status: 400 });
  }

  const queued = await queueDueEvotorSyncs({
    syncType: parsed.data.mode,
    requestedBy: "timeweb-scheduler"
  });
  const results = await processPendingEvotorSyncEvents(parsed.data.limit);

  return NextResponse.json({
    ok: true,
    mode: parsed.data.mode,
    queued: queued.length,
    processed: results.length
  });
}
