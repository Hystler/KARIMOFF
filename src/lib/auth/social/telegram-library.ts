import "server-only";

import { z } from "zod";
import { getTelegramLoginLibraryConfig } from "./config";
import { getSocialAuthError, SocialAuthError } from "./errors";
import { getJson, getSafeNetworkErrorCode } from "./telegram-http";
import { TELEGRAM_RS256_JWKS_SNAPSHOT } from "./telegram-jwks-snapshot";
import { isTelegramPhoneVerified, normalizeTelegramPhone } from "./telegram-protocol";
import { TELEGRAM_OIDC_ISSUER, verifyTelegramIdToken } from "./telegram-token";
import type { SocialIdentityClaims } from "./types";

const TELEGRAM_JWKS_URL = `${TELEGRAM_OIDC_ISSUER}/.well-known/jwks.json`;
const TELEGRAM_JWKS_TIMEOUT_MS = 5_000;
const TELEGRAM_JWKS_RETRIES = 2;
const TELEGRAM_JWKS_TTL_MS = 6 * 60 * 60_000;
const TELEGRAM_JWKS_REFRESH_INTERVAL_MS = 60 * 60_000;

type TelegramJwk = Record<string, unknown> & { kid?: string; alg?: string; use?: string };

const bundledKeys = TELEGRAM_RS256_JWKS_SNAPSHOT.map((key) => ({ ...key })) as TelegramJwk[];

let cachedKeys: { expiresAt: number; keys: TelegramJwk[] } = {
  expiresAt: Number.POSITIVE_INFINITY,
  keys: bundledKeys
};
let lastRefreshAttemptAt = 0;
let refreshPromise: Promise<void> | null = null;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchTelegramKeys() {
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

      const parsed = z.object({
        keys: z.array(z.record(z.string(), z.unknown())).min(1)
      }).safeParse(response.payload);
      if (!parsed.success) {
        throw new SocialAuthError({ code: "jwks_invalid", stage: "jwks" });
      }

      const keys = parsed.data.keys as TelegramJwk[];
      cachedKeys = { expiresAt: Date.now() + TELEGRAM_JWKS_TTL_MS, keys };
      return keys;
    } catch (error) {
      const failure = getSocialAuthError(error, "jwks");
      lastError = failure.code === "unknown"
        ? new SocialAuthError({
            code: "jwks_unavailable",
            stage: "jwks",
            networkError: getSafeNetworkErrorCode(error),
            cause: error
          })
        : failure;
      if (attempt + 1 < TELEGRAM_JWKS_RETRIES) {
        await wait(250 * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new SocialAuthError({ code: "jwks_unavailable", stage: "jwks" });
}

function refreshTelegramKeysInBackground() {
  const now = Date.now();
  if (refreshPromise || now - lastRefreshAttemptAt < TELEGRAM_JWKS_REFRESH_INTERVAL_MS) return;
  lastRefreshAttemptAt = now;
  refreshPromise = fetchTelegramKeys()
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      refreshPromise = null;
    });
}

async function getTelegramKeys(forceRefresh = false) {
  if (!forceRefresh && cachedKeys.keys.length > 0) {
    if (cachedKeys.expiresAt <= Date.now() || cachedKeys.keys === bundledKeys) {
      refreshTelegramKeysInBackground();
    }
    return cachedKeys.keys;
  }

  return fetchTelegramKeys();
}

export async function verifyTelegramLibraryIdToken(params: {
  idToken: string;
  expectedNonce: string;
}): Promise<SocialIdentityClaims> {
  const config = getTelegramLoginLibraryConfig();
  if (!config) {
    throw new SocialAuthError({ code: "token_unavailable", stage: "id_token" });
  }

  let keys = await getTelegramKeys();
  let claims;
  try {
    claims = verifyTelegramIdToken({
      token: params.idToken,
      keys,
      expectedAudience: config.clientId,
      expectedNonce: params.expectedNonce
    });
  } catch (error) {
    const failure = getSocialAuthError(error, "id_token");
    if (failure.code !== "id_token_signing_key") throw failure;

    keys = await getTelegramKeys(true);
    claims = verifyTelegramIdToken({
      token: params.idToken,
      keys,
      expectedAudience: config.clientId,
      expectedNonce: params.expectedNonce
    });
  }

  const phone = normalizeTelegramPhone(claims.phone_number);

  return {
    provider: "telegram",
    providerUserId: claims.sub,
    username: claims.preferred_username ?? null,
    displayName: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
    email: null,
    phone,
    phoneVerified: isTelegramPhoneVerified(phone, claims.phone_number_verified),
    metadata: {
      givenName: claims.given_name ?? null,
      familyName: claims.family_name ?? null,
      loginFlow: "telegram_login_library",
      botAccessRequested: true
    }
  };
}
