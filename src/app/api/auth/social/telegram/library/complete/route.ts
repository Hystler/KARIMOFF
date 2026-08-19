import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  checkAuthRateLimit,
  clearAuthFailures,
  recordAuthFailure
} from "@/lib/auth-rate-limit";
import { getSocialAuthError, getSocialResultReason, type SocialAuthStage } from "@/lib/auth/social/errors";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import { consumeOAuthAttempt } from "@/lib/auth/social/state";
import { verifyTelegramLibraryIdToken } from "@/lib/auth/social/telegram-library";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  attemptId: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  idToken: z.string().min(64).max(16_384)
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "invalid_request" }, 400);
  }

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateLimitKey = `telegram:${clientKey}`;
  const limit = await checkAuthRateLimit("social_oauth", rateLimitKey);
  if (!limit.allowed) {
    return noStoreJson({ ok: false, error: "rate_limit" }, 429);
  }

  let correlationId: string = randomUUID();
  let stage: SocialAuthStage = "state";

  try {
    const attempt = await consumeOAuthAttempt("telegram", parsed.data.attemptId, {
      requireBrowserBinding: true
    });
    correlationId = attempt.id;
    logTelegramAuthEvent("telegram.library.result", {
      attemptId: correlationId,
      stage: "callback",
      browserBinding: attempt.browserBinding
    });

    stage = "id_token";
    const claims = await verifyTelegramLibraryIdToken({
      idToken: parsed.data.idToken,
      expectedNonce: attempt.nonce ?? ""
    });
    logTelegramAuthEvent("telegram.id_token.valid", {
      attemptId: correlationId,
      stage: "id_token"
    });

    stage = "identity";
    const result = await completeProviderCallback(claims, attempt, {
      sourcePath: "/api/auth/social/telegram/library/complete"
    });
    logTelegramAuthEvent("telegram.identity.resolved", {
      attemptId: correlationId,
      stage: "identity",
      resolution: result.kind
    });

    if (result.kind === "authenticated") {
      logTelegramAuthEvent("telegram.session.created", {
        attemptId: correlationId,
        stage: "session"
      });
      logTelegramAuthEvent("telegram.session.readback", {
        attemptId: correlationId,
        stage: "session"
      });
    }

    await clearAuthFailures("social_oauth", rateLimitKey);

    return noStoreJson({
      ok: true,
      returnTo: result.redirectTo,
      status: result.kind
    });
  } catch (error) {
    const failure = getSocialAuthError(error, stage);
    await recordAuthFailure("social_oauth", rateLimitKey);
    logTelegramAuthEvent("telegram.failed", {
      attemptId: correlationId,
      stage: failure.stage,
      errorCode: failure.code,
      httpStatus: failure.httpStatus,
      networkError: failure.networkError,
      providerError: failure.providerError
    });
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: {
        provider: "telegram",
        attempt_id: correlationId,
        stage: failure.stage,
        error_code: failure.code
      },
      sourcePath: "/api/auth/social/telegram/library/complete"
    }).catch(() => undefined);

    const reason = getSocialResultReason(failure);
    const status = reason === "expired" ? 410 : reason === "link_conflict" ? 409 : 400;
    return noStoreJson({ ok: false, error: reason }, status);
  }
}
