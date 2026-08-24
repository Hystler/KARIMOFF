import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { getTelegramLoginLibraryConfig } from "@/lib/auth/social/config";
import { createOAuthAttempt, sanitizeSocialRedirect } from "@/lib/auth/social/state";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  intent: z.enum(["login", "link"]).default("login"),
  returnTo: z.string().max(500).optional()
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

  const config = getTelegramLoginLibraryConfig();
  if (!config) {
    return noStoreJson({ ok: false, error: "unavailable" }, 503);
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

  await recordAuthFailure("social_oauth", rateLimitKey);

  try {
    const returnTo = sanitizeSocialRedirect(parsed.data.returnTo);
    const attempt = await createOAuthAttempt({
      provider: "telegram",
      intent: parsed.data.intent,
      redirectTo: returnTo
    });
    if (!attempt.nonce) {
      return noStoreJson({ ok: false, error: "start_failed" }, 500);
    }

    logTelegramAuthEvent("telegram.library.start", {
      attemptId: attempt.attemptId,
      stage: "start"
    });
    logTelegramAuthEvent("telegram.login.started", {
      attemptId: attempt.attemptId,
      stage: "start"
    });

    return noStoreJson({
      ok: true,
      attemptId: attempt.attemptId,
      clientId: config.clientIdNumber,
      expiresInSeconds: attempt.expiresInSeconds,
      nonce: attempt.nonce,
      returnTo
    });
  } catch {
    return noStoreJson({ ok: false, error: "start_failed" }, 500);
  }
}
