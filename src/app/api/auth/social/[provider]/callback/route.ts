import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { completeProviderCallback } from "@/lib/auth/social/identity";
import { consumeOAuthAttempt } from "@/lib/auth/social/state";
import { exchangeTelegramCode } from "@/lib/auth/social/telegram";
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
  if (!state) {
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=cancelled"));
  }

  try {
    const attempt = await consumeOAuthAttempt(rawProvider, state);
    if (providerError || !code) {
      return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=cancelled"));
    }
    const claims = rawProvider === "telegram"
      ? await exchangeTelegramCode({
          code,
          codeVerifier: attempt.codeVerifier,
          expectedNonce: attempt.nonce ?? ""
        })
      : await exchangeVkCode({
          code,
          deviceId: request.nextUrl.searchParams.get("device_id") ?? "",
          state,
          codeVerifier: attempt.codeVerifier
        });
    const result = await completeProviderCallback(claims, attempt);
    const destination = getPublicRequestUrl(request, result.redirectTo);
    if (result.kind === "linked") destination.searchParams.set("identity", "linked");
    return NextResponse.redirect(destination);
  } catch {
    await writeAuditLog({
      action: "customer.social_login_failed",
      actorType: "system",
      entityType: "customer",
      metadata: { provider: rawProvider },
      sourcePath: `/api/auth/social/${rawProvider}/callback`
    });
    return NextResponse.redirect(getPublicRequestUrl(request, "/login?socialError=validation_failed"));
  }
}
