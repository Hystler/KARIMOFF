import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { getMaxChallengeContext, MaxChallengeError } from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  bridgePlatform: z.enum(["android", "desktop", "ios", "web", "unknown"]).optional(),
  bridgeVersion: z.string().max(32).optional(),
  challenge: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  event: z.enum(["miniapp_loaded", "contact_requested"]),
  requestContactAvailable: z.boolean().optional()
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkAuthRateLimit("social_oauth", `max-event:${clientKey}`);
  if (!limit.allowed) return noStoreJson({ ok: false, error: "rate_limit" }, 429);

  try {
    const context = await getMaxChallengeContext(parsed.data.challenge);
    logMaxAuthEvent(
      parsed.data.event === "miniapp_loaded" ? "max.miniapp.loaded" : "max.contact.requested",
      {
        correlationId: context.correlationId,
        stage: parsed.data.event === "miniapp_loaded" ? "miniapp" : "contact",
        bridgePlatform: parsed.data.bridgePlatform,
        bridgeVersion: parsed.data.bridgeVersion,
        requestContactAvailable: parsed.data.requestContactAvailable
      }
    );
    return noStoreJson({ ok: true });
  } catch (error) {
    const errorCode = error instanceof MaxChallengeError ? error.code : "technical";
    logMaxAuthEvent("max.failed", {
      correlationId: "unresolved",
      stage: parsed.data.event === "miniapp_loaded" ? "miniapp" : "contact",
      errorCode
    });
    return noStoreJson({ ok: false, error: errorCode }, errorCode === "challenge_expired" ? 410 : 400);
  }
}
