import { after, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import {
  consumeEvotorRateLimit,
  verifyEvotorWebhookAuthorization
} from "@/lib/integrations/evotor/auth";
import { registerEvotorConnection } from "@/lib/integrations/evotor/repository";
import { processEvotorSyncEvent } from "@/lib/integrations/evotor/sync";
import { evotorTokenDeliverySchema } from "@/lib/integrations/evotor/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error: message }, { status, headers });
}

export async function POST(request: Request) {
  if (process.env.EVOTOR_ENABLED !== "true") {
    return jsonError("Integration is disabled.", 503);
  }

  const rate = await consumeEvotorRateLimit(request, "evotor-token", 20);
  if (!rate.allowed) {
    return jsonError("Too many requests.", 429, { "Retry-After": String(rate.retry_after_seconds) });
  }
  if (!verifyEvotorWebhookAuthorization(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return jsonError("Request body is too large.", 413);

  let unknownPayload: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return jsonError("Request body is too large.", 413);
    }
    unknownPayload = JSON.parse(body);
  } catch {
    return jsonError("Invalid JSON.", 400);
  }

  const payload = evotorTokenDeliverySchema.safeParse(unknownPayload);
  if (!payload.success) return jsonError("Invalid token delivery payload.", 400);

  const result = await registerEvotorConnection(payload.data.userId, payload.data.token);
  await writeAuditLog({
    action: "evotor.token.received",
    actorType: "system",
    entityType: "evotor_connection",
    entityId: result.connectionId,
    metadata: { token_rotated: result.tokenChanged },
    sourcePath: "/api/integrations/evotor/token",
    userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null
  });
  after(async () => {
    await processEvotorSyncEvent(result.eventId);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
