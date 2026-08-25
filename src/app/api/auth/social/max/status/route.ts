import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getMaxBrowserChallengeStatus,
  MaxChallengeError
} from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  attempt: z.string().uuid(),
  reason: z.enum(["focus", "initial", "interval", "online", "pageshow", "resume", "visibility"])
    .default("interval")
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const parsed = querySchema.safeParse({
    attempt: request.nextUrl.searchParams.get("attempt"),
    reason: request.nextUrl.searchParams.get("reason") ?? undefined
  });
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  try {
    const result = await getMaxBrowserChallengeStatus(parsed.data.attempt);
    if (parsed.data.reason !== "interval") {
      logMaxAuthEvent("max.browser.poll", {
        browserTrigger: parsed.data.reason,
        correlationId: result.correlationId,
        stage: "browser"
      });
    }
    if (["focus", "pageshow", "resume", "visibility"].includes(parsed.data.reason)) {
      logMaxAuthEvent("max.browser.resume", {
        browserTrigger: parsed.data.reason,
        correlationId: result.correlationId,
        stage: "browser"
      });
    }
    if (result.status === "completed") {
      logMaxAuthEvent("max.browser.poll.completed", {
        browserTrigger: parsed.data.reason,
        correlationId: result.correlationId,
        stage: "browser"
      });
      logMaxAuthEvent("max.browser.status.completed", {
        browserTrigger: parsed.data.reason,
        correlationId: result.correlationId,
        stage: "browser"
      });
    }
    return noStoreJson({ ok: true, status: result.status });
  } catch (error) {
    const errorCode = error instanceof MaxChallengeError ? error.code : "technical";
    return noStoreJson(
      { ok: false, error: errorCode },
      errorCode === "browser_binding_mismatch" ? 403 : 400
    );
  }
}
