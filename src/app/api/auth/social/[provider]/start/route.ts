import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { getCustomerSession } from "@/lib/customer-auth";
import { getSocialProviderConfig } from "@/lib/auth/social/config";
import { getTelegramAuthorizeUrl } from "@/lib/auth/social/telegram";
import { createOAuthAttempt, sanitizeSocialRedirect } from "@/lib/auth/social/state";
import { isSocialProvider } from "@/lib/auth/social/types";
import { getVkAuthorizeUrl } from "@/lib/auth/social/vk";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  if (!isSocialProvider(rawProvider) || !getSocialProviderConfig(rawProvider)) {
    return NextResponse.redirect(new URL("/login?socialError=unavailable", request.url));
  }

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkAuthRateLimit("social_oauth", `${rawProvider}:${clientKey}`);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL("/login?socialError=rate_limit", request.url));
  }
  await recordAuthFailure("social_oauth", `${rawProvider}:${clientKey}`);

  const intent = request.nextUrl.searchParams.get("intent") === "link" ? "link" : "login";
  if (intent === "link" && !(await getCustomerSession())) {
    const login = new URL("/login", request.url);
    login.searchParams.set("redirectTo", "/profile");
    return NextResponse.redirect(login);
  }

  try {
    const attempt = await createOAuthAttempt({
      provider: rawProvider,
      intent,
      redirectTo: sanitizeSocialRedirect(request.nextUrl.searchParams.get("returnTo"))
    });
    const authorizeUrl = rawProvider === "telegram"
      ? getTelegramAuthorizeUrl({
          state: attempt.state,
          nonce: attempt.nonce ?? "",
          codeChallenge: attempt.codeChallenge
        })
      : getVkAuthorizeUrl({ state: attempt.state, codeChallenge: attempt.codeChallenge });
    return NextResponse.redirect(authorizeUrl);
  } catch {
    return NextResponse.redirect(new URL("/login?socialError=start_failed", request.url));
  }
}
