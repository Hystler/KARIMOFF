import "server-only";

import { z } from "zod";
import { getSocialProviderConfig, shouldRequestSocialPhone } from "./config";
import { getSocialAuthError, SocialAuthError } from "./errors";
import { getJson, getSafeNetworkErrorCode, postFormJson } from "./telegram-http";
import { normalizeTelegramPhone, parseTelegramTokenResponse } from "./telegram-protocol";
import { TELEGRAM_OIDC_ISSUER, verifyTelegramIdToken } from "./telegram-token";
import type { SocialIdentityClaims } from "./types";

const TELEGRAM_ISSUER = TELEGRAM_OIDC_ISSUER;
const TELEGRAM_TOKEN_URL = `${TELEGRAM_ISSUER}/token`;
const TELEGRAM_JWKS_URL = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;
const TELEGRAM_TOKEN_TIMEOUT_MS = 30_000;
const TELEGRAM_JWKS_TIMEOUT_MS = 12_000;
const TELEGRAM_JWKS_RETRIES = 3;

type TelegramJwk = Record<string, unknown> & { kid?: string; alg?: string; use?: string };
let cachedKeys: { expiresAt: number; keys: TelegramJwk[] } | null = null;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getTelegramKeys(forceRefresh = false) {
  if (!forceRefresh && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  let lastError: SocialAuthError | null = null;

  for (let attempt = 0; attempt < TELEGRAM_JWKS_RETRIES; attempt += 1) {
    try {
      const response = await getJson({
        url: TELEGRAM_JWKS_URL,
        headers: { Accept: "application/json" },
        timeoutMs: TELEGRAM_JWKS_TIMEOUT_MS
      });
      if (!response.ok) {
        throw new SocialAuthError({
          code: "jwks_unavailable",
          stage: "jwks",
          httpStatus: response.status
        });
      }
      const payload = response.payload;
      const parsed = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) }).safeParse(payload);
      if (!parsed.success) {
        throw new SocialAuthError({ code: "jwks_invalid", stage: "jwks" });
      }
      const keys = parsed.data.keys as TelegramJwk[];
      cachedKeys = { expiresAt: Date.now() + 5 * 60_000, keys };
      return keys;
    } catch (error) {
      const failure = getSocialAuthError(error, "jwks");
      lastError = failure.code === "unknown"
        ? new SocialAuthError({ code: "jwks_unavailable", stage: "jwks", cause: error })
        : failure;
      if (attempt + 1 < TELEGRAM_JWKS_RETRIES) await wait(250 * 2 ** attempt);
    }
  }

  throw lastError ?? new SocialAuthError({ code: "jwks_unavailable", stage: "jwks" });
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
  onStage?: (stage: "token_exchange.success" | "id_token.valid") => void;
}): Promise<SocialIdentityClaims> {
  const config = getSocialProviderConfig("telegram");
  if (!config?.clientSecret) {
    throw new SocialAuthError({ code: "token_unavailable", stage: "token_exchange" });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: params.codeVerifier
  });
  let response: Awaited<ReturnType<typeof postFormJson>>;
  try {
    response = await postFormJson({
      url: TELEGRAM_TOKEN_URL,
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      timeoutMs: TELEGRAM_TOKEN_TIMEOUT_MS
    });
  } catch (error) {
    throw new SocialAuthError({
      code: "token_unavailable",
      stage: "token_exchange",
      networkError: getSafeNetworkErrorCode(error),
      cause: error
    });
  }

  const token = parseTelegramTokenResponse(response);
  params.onStage?.("token_exchange.success");

  let keys = await getTelegramKeys();
  let claims;
  try {
    claims = verifyTelegramIdToken({
      token: token.id_token,
      keys,
      expectedAudience: config.clientId,
      expectedNonce: params.expectedNonce
    });
  } catch (error) {
    const failure = getSocialAuthError(error, "id_token");
    if (failure.code !== "id_token_signing_key") throw failure;
    keys = await getTelegramKeys(true);
    claims = verifyTelegramIdToken({
      token: token.id_token,
      keys,
      expectedAudience: config.clientId,
      expectedNonce: params.expectedNonce
    });
  }
  params.onStage?.("id_token.valid");

  const phone = normalizeTelegramPhone(claims.phone_number);

  return {
    provider: "telegram",
    providerUserId: claims.sub,
    username: claims.preferred_username ?? null,
    displayName: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
    email: null,
    phone,
    phoneVerified: Boolean(phone && claims.phone_number_verified),
    metadata: {
      givenName: claims.given_name ?? null,
      familyName: claims.family_name ?? null
    }
  };
}
