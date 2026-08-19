import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { getCustomerSession } from "@/lib/customer-auth";
import { getSocialProviderConfig } from "@/lib/auth/social/config";
import { buildSocialResultPath } from "@/lib/auth/social/redirect";
import { getTelegramAuthorizeUrl } from "@/lib/auth/social/telegram";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { createOAuthAttempt, sanitizeSocialRedirect } from "@/lib/auth/social/state";
import { isSocialProvider } from "@/lib/auth/social/types";
import { getVkAuthorizeUrl } from "@/lib/auth/social/vk";
import { getPublicRequestUrl } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  if (!isSocialProvider(rawProvider)) {
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=unavailable"));
  }
  const returnTo = sanitizeSocialRedirect(request.nextUrl.searchParams.get("returnTo"));
  if (!getSocialProviderConfig(rawProvider)) {
    return NextResponse.redirect(getPublicRequestUrl(request, buildSocialResultPath({
      provider: rawProvider,
      status: "error",
      returnTo,
      reason: "unavailable"
    })));
  }

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkAuthRateLimit("social_oauth", `${rawProvider}:${clientKey}`);
  if (!limit.allowed) {
    return NextResponse.redirect(getPublicRequestUrl(request, buildSocialResultPath({
      provider: rawProvider,
      status: "error",
      returnTo,
      reason: "rate_limit"
    })));
  }
  await recordAuthFailure("social_oauth", `${rawProvider}:${clientKey}`);

  const intent = request.nextUrl.searchParams.get("intent") === "link" ? "link" : "login";
  if (intent === "link" && !(await getCustomerSession())) {
    const login = getPublicRequestUrl(request, "/login");
    login.searchParams.set("redirectTo", "/profile");
    return NextResponse.redirect(login);
  }

  try {
    const attempt = await createOAuthAttempt({
      provider: rawProvider,
      intent,
      redirectTo: returnTo
    });
    const authorizeUrl = rawProvider === "telegram"
      ? getTelegramAuthorizeUrl({
          state: attempt.state,
          nonce: attempt.nonce ?? "",
          codeChallenge: attempt.codeChallenge
        })
      : getVkAuthorizeUrl({ state: attempt.state, codeChallenge: attempt.codeChallenge });
    if (rawProvider === "telegram") {
      logTelegramAuthEvent("telegram.start", {
        attemptId: attempt.attemptId,
        stage: "start"
      });
    }
    return NextResponse.redirect(authorizeUrl);
  } catch {
    return NextResponse.redirect(getPublicRequestUrl(request, buildSocialResultPath({
      provider: rawProvider,
      status: "error",
      returnTo,
      reason: "start_failed"
    })));
  }
}
