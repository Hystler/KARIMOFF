import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acknowledgeMaxChallenge,
  clearMaxChallengeCookie,
  MaxChallengeError
} from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
import { readPendingSocialIdentity } from "@/lib/auth/social/state";
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
    const result = await acknowledgeMaxChallenge(parsed.data.attemptId);
    logMaxAuthEvent("max.redirect.success", {
      correlationId: result.correlationId,
      stage: "redirect"
    });
    await clearMaxChallengeCookie();
    return noStoreJson({ ok: true, returnTo: result.redirectTo });
  } catch (error) {
    const errorCode = error instanceof MaxChallengeError ? error.code : "technical";
    return noStoreJson({ ok: false, error: errorCode }, errorCode === "challenge_replay" ? 409 : 400);
  }
}
