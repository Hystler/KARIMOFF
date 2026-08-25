import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { clearAuthFailures } from "@/lib/auth-rate-limit";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import {
  claimCompletedMaxChallenge,
  markMaxChallengeConsumed,
  MaxChallengeError,
  releaseMaxChallengeClaim,
  type ClaimedMaxChallenge
} from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
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

  let claimed: ClaimedMaxChallenge | null = null;
  try {
    const result = await claimCompletedMaxChallenge(parsed.data.attemptId);
    if ("kind" in result) {
      if (result.kind === "waiting") {
        return noStoreJson({ ok: true, status: "waiting" }, 202);
      }
      if (result.kind === "failed") {
        return noStoreJson({ ok: false, error: "technical" }, 409);
      }
      const current = await getCustomerSession();
      if (!current) throw new MaxChallengeError("challenge_replay");
      return noStoreJson({
        ok: true,
        status: "authenticated",
        returnTo: result.redirectTo
      });
    }

    claimed = result;
    logMaxAuthEvent("max.browser.consume", {
      correlationId: claimed.correlationId,
      idempotent: claimed.alreadyConsumed,
      stage: "browser"
    });
    const resolution = await completeProviderCallback(claimed.claims, claimed.completion, {
      sourcePath: "/api/auth/social/max/consume"
    });
    if (resolution.kind === "authenticated") {
      logMaxAuthEvent("max.session.created", {
        correlationId: claimed.correlationId,
        idempotent: claimed.alreadyConsumed,
        stage: "session"
      });
      logMaxAuthEvent("max.session.readback.ok", {
        correlationId: claimed.correlationId,
        idempotent: claimed.alreadyConsumed,
        stage: "session"
      });
    }
    await markMaxChallengeConsumed(claimed.attemptId);
    const requestHeaders = await headers();
    const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await clearAuthFailures("social_oauth", `max:${clientKey}`).catch(() => undefined);
    return noStoreJson({
      ok: true,
      status: resolution.kind,
      returnTo: resolution.redirectTo
    });
  } catch (error) {
    const errorCode = error instanceof MaxChallengeError
      ? error.code
      : (error as { code?: string })?.code === "identity_conflict"
        ? "identity_conflict"
        : "technical";
    if (claimed) await releaseMaxChallengeClaim(claimed.attemptId, errorCode).catch(() => undefined);
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: {
        provider: "max",
        attempt_id: claimed?.correlationId ?? parsed.data.attemptId,
        error_code: errorCode
      },
      sourcePath: "/api/auth/social/max/consume"
    }).catch(() => undefined);
    const status = errorCode === "challenge_expired" ? 410
      : errorCode === "identity_conflict" || errorCode === "challenge_replay" ? 409
        : errorCode === "browser_binding_mismatch" ? 403
          : 400;
    return noStoreJson({ ok: false, error: errorCode }, status);
  }
}
