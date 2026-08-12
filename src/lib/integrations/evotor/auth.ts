import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyEvotorWebhookAuthorization(request: Request) {
  const expected = process.env.EVOTOR_WEBHOOK_AUTH_TOKEN?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(authorization.slice(7).trim(), expected);
}

function requestAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function consumeEvotorRateLimitKey(scope: string, identifier: string, limit = 30) {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("AUTH_RATE_LIMIT_SECRET is not configured.");
  const keyHash = createHmac("sha256", secret)
    .update(`${scope}:${identifier}`)
    .digest("hex");
  const sql = getPostgresSql();
  const rows = await sql<{ allowed: boolean; retry_after_seconds: number }[]>`
    select allowed, retry_after_seconds
    from public.consume_integration_rate_limit(${keyHash}, ${limit}, 60, 300)
  `;
  return rows[0] ?? { allowed: false, retry_after_seconds: 60 };
}

export function consumeEvotorRateLimit(request: Request, scope: string, limit = 30) {
  return consumeEvotorRateLimitKey(scope, requestAddress(request), limit);
}
