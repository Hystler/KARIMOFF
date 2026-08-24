import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSocialAuthError } from "@/lib/auth/social/errors";
import {
  acknowledgeTelegramAttempt,
  clearTelegramAttemptCookie,
  readPendingSocialIdentity
} from "@/lib/auth/social/state";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { getCustomerSession } from "@/lib/customer-auth";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ attemptId: z.string().uuid() });

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  const [session, pendingIdentity] = await Promise.all([
    getCustomerSession(),
    readPendingSocialIdentity()
  ]);
  if (!session && !pendingIdentity) {
    return noStoreJson({ ok: false, error: "session_missing" }, 401);
  }

  try {
    const result = await acknowledgeTelegramAttempt(parsed.data.attemptId, {
      sessionUserId: session?.customerId ?? null,
      pendingIdentity: pendingIdentity ? {
        provider: pendingIdentity.provider,
        providerUserId: pendingIdentity.provider_user_id
      } : null
    });
    logTelegramAuthEvent("telegram.redirect.success", {
      attemptId: result.correlationId,
      stage: "redirect"
    });
    logTelegramAuthEvent("telegram.client.completed", {
      attemptId: result.correlationId,
      stage: "redirect"
    });
    await clearTelegramAttemptCookie();
    return noStoreJson({
      ok: true,
      returnTo: pendingIdentity ? "/login/social/complete" : result.redirectTo
    });
  } catch (error) {
    const failure = getSocialAuthError(error, "redirect");
    return noStoreJson({ ok: false, error: failure.code }, failure.code === "state_replay" ? 409 : 400);
  }
}
