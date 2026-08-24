import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { clearAuthFailures } from "@/lib/auth-rate-limit";
import { getSocialAuthError } from "@/lib/auth/social/errors";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import {
  claimCompletedTelegramAttempt,
  markTelegramAttemptPrepared,
  readPendingSocialIdentity,
  releaseTelegramAttemptClaim,
  type ClaimedTelegramAttempt
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

  let claimed: ClaimedTelegramAttempt | null = null;
  try {
    const result = await claimCompletedTelegramAttempt(parsed.data.attemptId);
    if ("kind" in result) {
      if (result.kind === "waiting") return noStoreJson({ ok: true, status: "waiting" }, 202);
      if (result.kind === "failed") return noStoreJson({ ok: false, error: "technical" }, 409);

      const [session, pendingIdentity] = await Promise.all([
        getCustomerSession(),
        readPendingSocialIdentity()
      ]);
      if (!session && !pendingIdentity) return noStoreJson({ ok: false, error: "session_missing" }, 401);
      const status = result.completionResult ?? (pendingIdentity ? "needs_phone" : "authenticated");
      return noStoreJson({
        ok: true,
        status,
        returnTo: status === "needs_phone" ? "/login/social/complete" : result.redirectTo
      });
    }

    claimed = result;
    logTelegramAuthEvent("telegram.browser.consume", {
      attemptId: claimed.correlationId,
      stage: "browser"
    });
    const [currentSession, currentPendingIdentity] = claimed.preparedResult
      ? await Promise.all([getCustomerSession(), readPendingSocialIdentity()])
      : [null, null];
    const preparedSessionIsReadable = claimed.preparedResult === "needs_phone"
      ? currentPendingIdentity?.provider === claimed.claims.provider
        && currentPendingIdentity.provider_user_id === claimed.claims.providerUserId
      : Boolean(currentSession && currentSession.customerId === claimed.resolvedUserId);
    const resolution = preparedSessionIsReadable && claimed.preparedResult
      ? {
          kind: claimed.preparedResult,
          redirectTo: claimed.preparedResult === "needs_phone"
            ? "/login/social/complete"
            : claimed.completion.redirectTo
        }
      : await completeProviderCallback(claimed.claims, claimed.completion, {
          sourcePath: "/api/auth/social/telegram/consume"
        });
    logTelegramAuthEvent("telegram.identity.resolved", {
      attemptId: claimed.correlationId,
      resolution: resolution.kind,
      stage: "identity"
    });
    if (resolution.kind === "authenticated") {
      logTelegramAuthEvent("telegram.session.created", {
        attemptId: claimed.correlationId,
        stage: "session"
      });
      logTelegramAuthEvent("telegram.session.readback.ok", {
        attemptId: claimed.correlationId,
        stage: "session"
      });
    }

    const resolvedSession = resolution.kind === "needs_phone" ? null : await getCustomerSession();
    await markTelegramAttemptPrepared(
      claimed.attemptId,
      resolution.kind,
      resolvedSession?.customerId ?? null
    );
    const requestHeaders = await headers();
    const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await clearAuthFailures("social_oauth", `telegram:${clientKey}`).catch(() => undefined);
    return noStoreJson({
      ok: true,
      status: resolution.kind,
      returnTo: resolution.redirectTo
    });
  } catch (error) {
    const failure = getSocialAuthError(error, "session");
    if (claimed) await releaseTelegramAttemptClaim(claimed.attemptId, failure.code).catch(() => undefined);
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: {
        provider: "telegram",
        attempt_id: claimed?.correlationId ?? parsed.data.attemptId,
        stage: failure.stage,
        error_code: failure.code
      },
      sourcePath: "/api/auth/social/telegram/consume"
    }).catch(() => undefined);
    const status = failure.code === "expired_state" ? 410
      : failure.code === "identity_conflict" || failure.code === "state_replay" ? 409
        : failure.code === "browser_binding_mismatch" ? 403
          : 400;
    return noStoreJson({ ok: false, error: failure.code }, status);
  }
}
