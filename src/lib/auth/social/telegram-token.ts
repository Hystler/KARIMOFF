import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";

class TelegramIdTokenError extends Error {
  readonly stage = "id_token" as const;
  readonly code: string;

  constructor(code: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "TelegramIdTokenError";
    this.code = code;
  }
}

export const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  nonce: z.string().min(1),
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().max(160).optional(),
  given_name: z.string().max(100).optional(),
  family_name: z.string().max(100).optional(),
  preferred_username: z.string().max(128).optional(),
  picture: z.string().url().max(2048).optional(),
  phone_number: z.string().max(32).optional(),
  phone_number_verified: z.boolean().optional()
});

function decodeSegment(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new TelegramIdTokenError("id_token_malformed", { cause: error });
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyTelegramIdToken(params: {
  token: string;
  keys: Array<Record<string, unknown>>;
  expectedAudience: string;
  expectedNonce: string;
  nowSeconds?: number;
}) {
  const segments = params.token.split(".");
  if (segments.length !== 3) {
    throw new TelegramIdTokenError("id_token_malformed");
  }
  const headerResult = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) }).safeParse(decodeSegment(segments[0]));
  const claimsResult = claimsSchema.safeParse(decodeSegment(segments[1]));
  if (!headerResult.success || !claimsResult.success) {
    throw new TelegramIdTokenError("id_token_malformed");
  }
  const header = headerResult.data;
  const claims = claimsResult.data;
  const key = params.keys.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === "RS256"));
  if (!key) {
    throw new TelegramIdTokenError("id_token_signing_key");
  }
  let signatureValid = false;
  try {
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${segments[0]}.${segments[1]}`),
      createPublicKey({ key: key as never, format: "jwk" }),
      Buffer.from(segments[2], "base64url")
    );
  } catch (error) {
    throw new TelegramIdTokenError("id_token_signature", { cause: error });
  }
  if (!signatureValid) {
    throw new TelegramIdTokenError("id_token_signature");
  }
  if (claims.iss !== TELEGRAM_OIDC_ISSUER) {
    throw new TelegramIdTokenError("id_token_issuer");
  }
  const audienceValid = Array.isArray(claims.aud)
    ? claims.aud.includes(params.expectedAudience)
    : claims.aud === params.expectedAudience;
  if (!audienceValid) {
    throw new TelegramIdTokenError("id_token_audience");
  }
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new TelegramIdTokenError("id_token_expired");
  }
  if (claims.iat > now + 60 || claims.iat > claims.exp) {
    throw new TelegramIdTokenError("id_token_future_iat");
  }
  if (!safeEqual(claims.nonce, params.expectedNonce)) {
    throw new TelegramIdTokenError("id_token_nonce");
  }
  return claims;
}
