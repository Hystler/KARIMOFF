import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_DOMAIN = "karimoff:staff-login-csrf:v1";

type TokenPayload = {
  expiresAt: number;
  issuedAt: number;
  nonce: string;
};

function getSigningKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured.");
  return createHmac("sha256", secret).update(TOKEN_DOMAIN).digest();
}

function sign(payload: string) {
  return createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
}

export function createStaffLoginCsrfToken(now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload: TokenPayload = {
    expiresAt: issuedAt + TOKEN_TTL_SECONDS,
    issuedAt,
    nonce: randomBytes(24).toString("base64url")
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyStaffLoginCsrfToken(token: string, now = Date.now()) {
  if (token.length > 512) return false;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;

  const actualSignature = Buffer.from(signature, "base64url");
  const expectedSignature = Buffer.from(sign(encodedPayload), "base64url");
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return false;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);
  return Number.isInteger(payload.issuedAt)
    && Number.isInteger(payload.expiresAt)
    && typeof payload.nonce === "string"
    && payload.nonce.length === 32
    && payload.issuedAt <= nowSeconds + 30
    && payload.expiresAt > nowSeconds
    && payload.expiresAt - payload.issuedAt <= TOKEN_TTL_SECONDS;
}
