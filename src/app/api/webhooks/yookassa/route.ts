import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { safeYooKassaErrorCode, YooKassaError } from "@/lib/payments/yookassa/errors";
import {
  isSupportedYooKassaWebhookEvent,
  processYooKassaWebhook
} from "@/lib/payments/yookassa/service";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  event: z.string().min(1).max(80),
  object: z.object({
    id: z.string().min(1).max(80)
  }).passthrough(),
  type: z.literal("notification")
}).passthrough();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    return response({ ok: false, error: "payload_too_large" }, 413);
  }

  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateLimitKey = `yookassa:${clientAddress}`;
  const rateLimit = await checkAuthRateLimit("payment_webhook", rateLimitKey);
  if (!rateLimit.allowed) return response({ ok: false, error: "rate_limited" }, 429);
  await recordAuthFailure("payment_webhook", rateLimitKey);

  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > 65_536) {
    return response({ ok: false, error: "payload_too_large" }, 413);
  }
  const parsedJson = (() => {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return null;
    }
  })();
  const parsed = webhookSchema.safeParse(parsedJson);
  if (!parsed.success) return response({ ok: false, error: "invalid_payload" }, 400);
  if (!isSupportedYooKassaWebhookEvent(parsed.data.event)) {
    return response({ ok: true, ignored: true });
  }

  try {
    await processYooKassaWebhook({
      event: parsed.data.event,
      objectId: parsed.data.object.id
    });
    return response({ ok: true });
  } catch (error) {
    if (error instanceof YooKassaError && error.kind === "validation" && !error.retryable) {
      return response({ ok: true, rejected: safeYooKassaErrorCode(error) });
    }
    return response({ ok: false, error: "provider_verification_failed" }, 503);
  }
}
