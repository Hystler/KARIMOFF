import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";

export const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";

const claimsSchema = z.object({
  iss: z.literal(TELEGRAM_OIDC_ISSUER),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  nonce: z.string().min(1),
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().max(160).optional(),
  preferred_username: z.string().max(128).optional(),
  picture: z.string().url().max(2048).optional(),
  phone_number: z.string().max(32).optional(),
  phone_number_verified: z.boolean().optional()
});

function decodeSegment(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && leftBuffer.equals(rightBuffer);
}

export function verifyTelegramIdToken(params: {
  token: string;
  keys: Array<Record<string, unknown>>;
  expectedAudience: string;
  expectedNonce: string;
  nowSeconds?: number;
}) {
  const segments = params.token.split(".");
  if (segments.length !== 3) throw new Error("Telegram ID token is invalid.");
  const header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) }).parse(decodeSegment(segments[0]));
  const claims = claimsSchema.parse(decodeSegment(segments[1]));
  const key = params.keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === "RS256"));
  if (!key) throw new Error("Telegram signing key is unknown.");
  const signatureValid = verify(
    "RSA-SHA256",
    Buffer.from(`${segments[0]}.${segments[1]}`),
    createPublicKey({ key: key as never, format: "jwk" }),
    Buffer.from(segments[2], "base64url")
  );
  const audienceValid = Array.isArray(claims.aud)
    ? claims.aud.includes(params.expectedAudience)
    : claims.aud === params.expectedAudience;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !signatureValid ||
    !audienceValid ||
    claims.exp <= now ||
    claims.iat > now + 60 ||
    !safeEqual(claims.nonce, params.expectedNonce)
  ) {
    throw new Error("Telegram ID token validation failed.");
  }
  return claims;
}
