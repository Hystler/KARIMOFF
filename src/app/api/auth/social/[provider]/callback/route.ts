import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSocialAuthError, getSocialResultReason, SocialAuthError, type SocialAuthStage } from "@/lib/auth/social/errors";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import { buildSocialResultPath } from "@/lib/auth/social/redirect";
import { consumeOAuthAttempt } from "@/lib/auth/social/state";
import { exchangeTelegramCode } from "@/lib/auth/social/telegram";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { isSocialProvider } from "@/lib/auth/social/types";
import { exchangeVkCode } from "@/lib/auth/social/vk";
import { getPublicRequestUrl } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  if (!isSocialProvider(rawProvider)) {
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=invalid_provider"));
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const providerError = request.nextUrl.searchParams.get("error");

  let returnTo = "/profile";
  let attemptId: string = randomUUID();
  let stage: SocialAuthStage = "callback";
  let tokenExchangeStartedAt: number | null = null;
  try {
    if (!state) {
      throw new SocialAuthError({
        code: providerError ? "provider_cancelled" : "missing_state",
        stage: "callback",
        providerError
      });
    }
    stage = "state";
    const attempt = await consumeOAuthAttempt(rawProvider, state);
    attemptId = attempt.id;
    returnTo = attempt.redirectTo;
    if (rawProvider === "telegram") {
      logTelegramAuthEvent("telegram.callback.received", {
        attemptId,
        stage: "callback",
        browserBinding: attempt.browserBinding
      });
    }
    if (providerError) {
      throw new SocialAuthError({
        code: "provider_cancelled",
        stage: "callback",
        providerError
      });
    }
    if (!code) {
      throw new SocialAuthError({ code: "missing_code", stage: "callback" });
    }
    stage = "token_exchange";
    const tokenExchangeStartTimestamp = Date.now();
    tokenExchangeStartedAt = tokenExchangeStartTimestamp;
    if (rawProvider === "telegram") {
      logTelegramAuthEvent("telegram.token_exchange.start", {
        attemptId,
        stage: "token_exchange"
      });
    }
    const claims = rawProvider === "telegram"
      ? await exchangeTelegramCode({
          code,
          codeVerifier: attempt.codeVerifier,
          expectedNonce: attempt.nonce ?? "",
          onStage: (telegramStage) => {
            if (telegramStage === "token_exchange.success") {
              logTelegramAuthEvent("telegram.token_exchange.success", {
                attemptId,
                stage: "token_exchange",
                durationMs: Date.now() - tokenExchangeStartTimestamp
              });
              stage = "id_token";
            } else {
              logTelegramAuthEvent("telegram.id_token.valid", {
                attemptId,
                stage: "id_token"
              });
              stage = "identity";
            }
          }
        })
      : await exchangeVkCode({
          code,
          deviceId: request.nextUrl.searchParams.get("device_id") ?? "",
          state,
          codeVerifier: attempt.codeVerifier
        });
    stage = "identity";
    const result = await completeProviderCallback(claims, attempt);
    if (rawProvider === "telegram") {
      logTelegramAuthEvent("telegram.identity.resolved", {
        attemptId,
        stage: "identity",
        resolution: result.kind
      });
    }
    if (result.kind === "needs_phone") {
      if (rawProvider === "telegram") {
        logTelegramAuthEvent("telegram.redirect.success", {
          attemptId,
          stage: "redirect"
        });
      }
      return NextResponse.redirect(getPublicRequestUrl(request, result.redirectTo));
    }
    if (rawProvider === "telegram" && result.kind === "authenticated") {
      logTelegramAuthEvent("telegram.session.created", {
        attemptId,
        stage: "session"
      });
      logTelegramAuthEvent("telegram.session.readback", {
        attemptId,
        stage: "session"
      });
    }
    const successTarget = result.kind === "authenticated"
      ? result.redirectTo
      : buildSocialResultPath({
          provider: rawProvider,
          status: "success",
          returnTo: result.redirectTo,
          linked: result.kind === "linked"
        });
    const response = NextResponse.redirect(getPublicRequestUrl(request, successTarget), 303);
    if (rawProvider === "telegram") {
      logTelegramAuthEvent("telegram.redirect.success", {
        attemptId,
        stage: "redirect"
      });
    }
    return response;
  } catch (error) {
    const failure = getSocialAuthError(error, stage);
    if (rawProvider === "telegram") {
      if (failure.stage === "token_exchange") {
        logTelegramAuthEvent("telegram.token_exchange.fail", {
          attemptId,
          stage: failure.stage,
          errorCode: failure.code,
          httpStatus: failure.httpStatus,
          networkError: failure.networkError,
          providerError: failure.providerError,
          durationMs: tokenExchangeStartedAt ? Date.now() - tokenExchangeStartedAt : null
        });
      }
      logTelegramAuthEvent("telegram.failed", {
        attemptId,
        stage: failure.stage,
        errorCode: failure.code,
        httpStatus: failure.httpStatus,
        networkError: failure.networkError,
        providerError: failure.providerError
      });
    }
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: {
        provider: rawProvider,
        attempt_id: attemptId,
        stage: failure.stage,
        error_code: failure.code,
        ...(failure.httpStatus ? { http_status: failure.httpStatus } : {}),
        ...(failure.networkError ? { network_error: failure.networkError } : {}),
        ...(failure.providerError ? { provider_error: failure.providerError } : {})
      },
      sourcePath: `/api/auth/social/${rawProvider}/callback`
    }).catch(() => undefined);
    return NextResponse.redirect(getPublicRequestUrl(request, buildSocialResultPath({
      provider: rawProvider,
      status: "error",
      returnTo,
      reason: getSocialResultReason(failure)
    })));
  }
}
