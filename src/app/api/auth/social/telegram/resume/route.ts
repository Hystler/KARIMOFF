import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSocialAuthError } from "@/lib/auth/social/errors";
import { getResumableTelegramAttempt } from "@/lib/auth/social/state";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ attemptId: z.string().uuid() });

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  try {
    const attempt = await getResumableTelegramAttempt(parsed.data.attemptId);
    return noStoreJson({ ok: true, attempt });
  } catch (error) {
    const failure = getSocialAuthError(error, "state");
    if (["browser_binding_mismatch", "expired_state", "state_not_found"].includes(failure.code)) {
      return noStoreJson({ ok: true, attempt: null });
    }
    return noStoreJson({ ok: false, error: "technical" }, 400);
  }
}
