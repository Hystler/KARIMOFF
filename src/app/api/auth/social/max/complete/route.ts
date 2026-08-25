import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAuthRateLimit, clearAuthFailures, recordAuthFailure } from "@/lib/auth-rate-limit";
import { getMaxAuthConfig } from "@/lib/auth/social/config";
import {
  completeMaxLoginChallenge,
  getMaxChallengeContext,
  MaxChallengeError
} from "@/lib/auth/social/max-challenge";
import { logMaxAuthEvent } from "@/lib/auth/social/max-observability";
import {
  MaxValidationError,
  describeMaxContact,
  validateMaxContact,
  validateMaxWebAppData
} from "@/lib/auth/social/max-protocol";
import { safeSecretEqual } from "@/lib/auth/social/crypto";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const contactSchema = z.object({
  authDate: z.string().min(1).max(32),
  hash: z.string().min(1).max(128),
  phone: z.string().min(7).max(32)
});
const requestSchema = z.object({
  challenge: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  contact: contactSchema.optional(),
  contactDenied: z.boolean().optional().default(false),
  initData: z.string().min(64).max(16_384)
}).refine((value) => !(value.contact && value.contactDenied), { message: "invalid contact state" });

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeErrorCode(error: unknown) {
  if (error instanceof MaxValidationError || error instanceof MaxChallengeError) return error.code;
  return "technical";
}

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return noStoreJson({ ok: false, error: "forbidden" }, 403);
  }
  const config = getMaxAuthConfig();
  if (!config) return noStoreJson({ ok: false, error: "unavailable" }, 503);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, 400);

  const requestHeaders = await headers();
  const clientKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateLimitKey = `max-webapp:${clientKey}`;
  const limit = await checkAuthRateLimit("social_oauth", rateLimitKey);
  if (!limit.allowed) return noStoreJson({ ok: false, error: "rate_limit" }, 429);

  let correlationId = "unresolved";
  try {
    const context = await getMaxChallengeContext(parsed.data.challenge);
    correlationId = context.correlationId;
    logMaxAuthEvent("max.webappdata.received", {
      correlationId,
      stage: "webappdata"
    });
    const verified = validateMaxWebAppData({
      initData: parsed.data.initData,
      botToken: config.botToken
    });
    if (!safeSecretEqual(verified.challenge, parsed.data.challenge)) {
      throw new MaxChallengeError("challenge_invalid");
    }
    logMaxAuthEvent("max.webappdata.valid", {
      correlationId,
      stage: "webappdata"
    });

    let claims = verified.claims;
    if (parsed.data.contact) {
      const contactDetails = describeMaxContact(parsed.data.contact);
      logMaxAuthEvent("max.contact.received", {
        correlationId,
        stage: "contact",
        authDateFormat: contactDetails.authDateFormat,
        contactHashFormat: contactDetails.hashFormat,
        phonePresent: contactDetails.phonePresent
      });
      const phone = validateMaxContact({
        contact: parsed.data.contact,
        botToken: config.botToken,
        userId: claims.providerUserId
      });
      claims = { ...claims, phone, phoneVerified: true };
      logMaxAuthEvent("max.contact.valid", {
        correlationId,
        stage: "contact",
        authDateFormat: contactDetails.authDateFormat,
        contactHashFormat: contactDetails.hashFormat,
        phonePresent: true
      });
    }

    const result = await completeMaxLoginChallenge({
      challenge: parsed.data.challenge,
      claims,
      contactDecision: parsed.data.contact ? "provided" : parsed.data.contactDenied ? "denied" : "not_requested"
    });
    await clearAuthFailures("social_oauth", rateLimitKey);
    logMaxAuthEvent("max.identity.resolved", {
      correlationId,
      stage: "identity",
      phonePresent: Boolean(claims.phone),
      resolution: result.identityResolution
    });
    if (result.kind === "completed") {
      logMaxAuthEvent("max.challenge.completed", {
        correlationId,
        stage: "challenge",
        phonePresent: Boolean(claims.phone)
      });
    }

    const returnUrl = new URL("/login?maxResume=1", config.miniAppUrl).toString();
    return noStoreJson({
      ok: true,
      status: result.kind,
      ...(result.kind === "completed" ? { returnUrl } : {})
    });
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await recordAuthFailure("social_oauth", rateLimitKey);
    logMaxAuthEvent("max.failed", {
      correlationId,
      stage: error instanceof MaxValidationError
        ? error.code.startsWith("contact_") ? "contact" : "webappdata"
        : "challenge",
      errorCode
    });
    const status = errorCode.includes("expired") ? 410 : errorCode.includes("replay") ? 409 : 400;
    return noStoreJson({ ok: false, error: errorCode }, status);
  }
}
