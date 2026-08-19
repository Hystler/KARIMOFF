import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConsumedOAuthAttemptId } from "@/lib/auth/social/state";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { getCustomerSession } from "@/lib/customer-auth";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  attemptId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/)
});

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(await getCustomerSession())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const correlationId = await getConsumedOAuthAttemptId("telegram", parsed.data.attemptId);
  if (!correlationId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  logTelegramAuthEvent("telegram.client.completed", {
    attemptId: correlationId,
    stage: "redirect"
  });

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" }
  });
}
