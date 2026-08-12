import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getPostgresSql } from "@/lib/postgres/server";
import {
  consumeEvotorRateLimit,
  verifyEvotorWebhookAuthorization
} from "@/lib/integrations/evotor/auth";
import {
  createEvotorSyncEvent,
  findEvotorConnectionByUserId
} from "@/lib/integrations/evotor/repository";
import { processEvotorSyncEvent } from "@/lib/integrations/evotor/sync";
import { evotorInstallationEventSchema } from "@/lib/integrations/evotor/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.EVOTOR_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "Integration is disabled." }, { status: 503 });
  }
  const rate = await consumeEvotorRateLimit(request, "evotor-installation", 30);
  if (!rate.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, {
      status: 429,
      headers: { "Retry-After": String(rate.retry_after_seconds) }
    });
  }
  if (!verifyEvotorWebhookAuthorization(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let unknownPayload: unknown;
  try {
    unknownPayload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = evotorInstallationEventSchema.safeParse(unknownPayload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid installation event." }, { status: 400 });
  }

  const connectionId = await findEvotorConnectionByUserId(parsed.data.data.userId);
  if (connectionId) {
    if (parsed.data.type === "ApplicationUninstalled") {
      const sql = getPostgresSql();
      await sql`
        update public.evotor_connections
        set status = 'uninstalled'
        where id = ${connectionId}::uuid
      `;
    } else {
      const idempotencyKey = createHash("sha256").update(`install:${parsed.data.id}`).digest("hex");
      const eventId = await createEvotorSyncEvent({
        connectionId,
        syncType: "installation",
        requestedBy: "evotor",
        idempotencyKey
      });
      after(async () => {
        await processEvotorSyncEvent(eventId);
      });
    }
  }

  await writeAuditLog({
    action: parsed.data.type === "ApplicationInstalled"
      ? "evotor.application.installed"
      : "evotor.application.uninstalled",
    actorType: "system",
    entityType: "evotor_connection",
    entityId: connectionId,
    metadata: { event_id_hash: createHash("sha256").update(parsed.data.id).digest("hex") },
    sourcePath: "/api/integrations/evotor/installation"
  });

  return NextResponse.json({ ok: true });
}
