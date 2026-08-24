import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSocialAuthError } from "@/lib/auth/social/errors";
import { getTelegramBrowserAttemptStatus } from "@/lib/auth/social/state";
import { logTelegramAuthEvent } from "@/lib/auth/social/telegram-observability";
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
    const result = await getTelegramBrowserAttemptStatus(parsed.data.attempt);
    if (["focus", "pageshow", "resume", "visibility"].includes(parsed.data.reason)) {
      logTelegramAuthEvent("telegram.browser.resume", {
        attemptId: result.correlationId,
        browserTrigger: parsed.data.reason,
        stage: "browser"
      });
    }
    if (result.status === "completed") {
      logTelegramAuthEvent("telegram.browser.status.completed", {
        attemptId: result.correlationId,
        browserTrigger: parsed.data.reason,
        stage: "browser"
      });
    }
    return noStoreJson({ ok: true, status: result.status });
  } catch (error) {
    const failure = getSocialAuthError(error, "state");
    return noStoreJson(
      { ok: false, error: failure.code },
      failure.code === "browser_binding_mismatch" ? 403 : 400
    );
  }
}
