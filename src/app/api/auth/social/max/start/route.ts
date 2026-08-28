import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { getMaxAuthConfig, logMaxAuthDiagnostics } from "@/lib/auth/social/config";
import { createMaxLoginChallenge } from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  intent: z.enum(["login", "link"]).default("login"),
  returnTo: z.string().max(500).optional()
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const config = getMaxAuthConfig();
  if (!config) {
    logMaxAuthDiagnostics("start");
    return noStoreJson({ ok: false, error: "unavailable" }, 503);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateLimitKey = `max:${clientKey}`;
  const limit = await checkAuthRateLimit("social_oauth", rateLimitKey);
  if (!limit.allowed) return noStoreJson({ ok: false, error: "rate_limit" }, 429);

  try {
    const attempt = await createMaxLoginChallenge({
      intent: parsed.data.intent,
      redirectTo: parsed.data.returnTo
    });
    await recordAuthFailure("social_oauth", rateLimitKey);
    logMaxAuthEvent("max.login.started", {
      correlationId: attempt.correlationId,
      stage: "start"
    });
    return noStoreJson({
      ok: true,
      attemptId: attempt.attemptId,
      expiresInSeconds: attempt.expiresInSeconds,
      launchUrl: `https://max.ru/${config.botName}?startapp=${attempt.challenge}`,
      returnTo: attempt.redirectTo
    });
  } catch {
    return noStoreJson({ ok: false, error: "start_failed" }, 500);
  }
}
