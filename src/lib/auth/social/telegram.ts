import "server-only";

import { z } from "zod";
import { normalizeRussianPhone } from "@/lib/phone";
import { getSocialProviderConfig, shouldRequestSocialPhone } from "./config";
import { TELEGRAM_OIDC_ISSUER, verifyTelegramIdToken } from "./telegram-token";
import type { SocialIdentityClaims } from "./types";

const TELEGRAM_ISSUER = TELEGRAM_OIDC_ISSUER;
const TELEGRAM_TOKEN_URL = `${TELEGRAM_ISSUER}/token`;
const TELEGRAM_JWKS_URL = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;

const tokenSchema = z.object({
  id_token: z.string().min(20),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
});

type TelegramJwk = Record<string, unknown> & { kid?: string; alg?: string; use?: string };
let cachedKeys: { expiresAt: number; keys: TelegramJwk[] } | null = null;

async function getTelegramKeys() {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(TELEGRAM_JWKS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("Telegram keys are unavailable.");
  const parsed = z.object({ keys: z.array(z.record(z.string(), z.unknown())) }).parse(await response.json());
  const keys = parsed.keys as TelegramJwk[];
  cachedKeys = { expiresAt: Date.now() + 5 * 60_000, keys };
  return keys;
}

export function getTelegramAuthorizeUrl(params: {
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const config = getSocialProviderConfig("telegram");
  if (!config) throw new Error("Telegram authentication is not configured.");
  const scope = shouldRequestSocialPhone() ? "openid profile phone" : "openid profile";
  const url = new URL(`${TELEGRAM_ISSUER}/auth`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256"
  }).toString();
  return url;
}

export async function exchangeTelegramCode(params: {
  code: string;
  codeVerifier: string;
  expectedNonce: string;
}): Promise<SocialIdentityClaims> {
  const config = getSocialProviderConfig("telegram");
  if (!config?.clientSecret) throw new Error("Telegram authentication is not configured.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: params.codeVerifier
  });
  const response = await fetch(TELEGRAM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) throw new Error("Telegram authorization was rejected.");
  const token = tokenSchema.parse(await response.json());
  const claims = verifyTelegramIdToken({
    token: token.id_token,
    keys: await getTelegramKeys(),
    expectedAudience: config.clientId,
    expectedNonce: params.expectedNonce
  });

  const normalizedPhone = claims.phone_number ? normalizeRussianPhone(claims.phone_number) : "";
  const phone = /^\+7\d{10}$/.test(normalizedPhone) ? normalizedPhone : null;

  return {
    provider: "telegram",
    providerUserId: claims.sub,
    username: claims.preferred_username ?? null,
    displayName: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
    email: null,
    phone,
    phoneVerified: Boolean(phone && claims.phone_number_verified),
    metadata: {}
  };
}
