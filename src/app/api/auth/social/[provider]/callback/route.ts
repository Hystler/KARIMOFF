import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSocialAuthError, getSocialResultReason, SocialAuthError, type SocialAuthStage } from "@/lib/auth/social/errors";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import { buildSocialResultPath } from "@/lib/auth/social/redirect";
import { consumeOAuthAttempt } from "@/lib/auth/social/state";
import { isSocialProvider } from "@/lib/auth/social/types";
import { exchangeVkCode } from "@/lib/auth/social/vk";
import { getPublicRequestUrl } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  if (!isSocialProvider(rawProvider)) {
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=invalid_provider"));
  }

  // Telegram web login is coordinated by the official JavaScript Login Library.
  // Keep this old callback closed so both protocols cannot compete for one attempt.
  if (rawProvider === "telegram") {
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=session_expired"), 303);
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const providerError = request.nextUrl.searchParams.get("error");

  let returnTo = "/profile";
  let attemptId: string = randomUUID();
  let stage: SocialAuthStage = "callback";

  try {
    if (!state) {
      throw new SocialAuthError({
        code: providerError ? "provider_cancelled" : "missing_state",
        stage: "callback",
        providerError
      });
    }

    stage = "state";
    const attempt = await consumeOAuthAttempt("vk", state);
    attemptId = attempt.id;
    returnTo = attempt.redirectTo;

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
    const claims = await exchangeVkCode({
      code,
      deviceId: request.nextUrl.searchParams.get("device_id") ?? "",
      state,
      codeVerifier: attempt.codeVerifier
    });
    stage = "identity";
    const result = await completeProviderCallback(claims, attempt);
    if (result.kind === "needs_phone") {
      return NextResponse.redirect(getPublicRequestUrl(request, result.redirectTo));
    }

    const successTarget = result.kind === "authenticated"
      ? result.redirectTo
      : buildSocialResultPath({
          provider: "vk",
          status: "success",
          returnTo: result.redirectTo,
          linked: result.kind === "linked"
        });
    return NextResponse.redirect(getPublicRequestUrl(request, successTarget), 303);
  } catch (error) {
    const failure = getSocialAuthError(error, stage);
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: {
        provider: "vk",
        attempt_id: attemptId,
        stage: failure.stage,
        error_code: failure.code,
        ...(failure.httpStatus ? { http_status: failure.httpStatus } : {}),
        ...(failure.networkError ? { network_error: failure.networkError } : {}),
        ...(failure.providerError ? { provider_error: failure.providerError } : {})
      },
      sourcePath: "/api/auth/social/vk/callback"
    }).catch(() => undefined);
    return NextResponse.redirect(getPublicRequestUrl(request, buildSocialResultPath({
      provider: "vk",
      status: "error",
      returnTo,
      reason: getSocialResultReason(failure)
    })));
  }
}
