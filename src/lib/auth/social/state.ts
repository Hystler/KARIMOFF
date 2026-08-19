import "server-only";

import { cookies, headers } from "next/headers";
import { getCustomerSession } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getPostgresSql } from "@/lib/postgres/server";
import { hashPrivacyValue } from "@/lib/legal-consents";
import {
  decryptOAuthSecret,
  encryptOAuthSecret,
  hashOAuthSecret,
  randomBase64Url,
  safeSecretEqual,
  sha256Base64Url
} from "./crypto";
import { sanitizeSocialRedirect } from "./redirect";
import type { SocialIdentityClaims, SocialProvider } from "./types";

const OAUTH_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;
const OAUTH_COOKIE_PREFIX = "karimoff_oauth_state_";
const PENDING_COOKIE = "karimoff_social_pending";

function secureCookie() {
  return process.env.NODE_ENV === "production";
}

export type ConsumedOAuthAttempt = {
  provider: SocialProvider;
  state: string;
  codeVerifier: string;
  nonce: string | null;
  intent: "login" | "link";
  linkingUserId: string | null;
  redirectTo: string;
};

export async function createOAuthAttempt(params: {
  provider: SocialProvider;
  intent: "login" | "link";
  redirectTo?: string | null;
}) {
  const customer = await getCustomerSession();
  if (params.intent === "link" && !customer) throw new Error("Сначала войдите в профиль.");
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const nonce = params.provider === "telegram" ? randomBase64Url() : null;
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");

  const { error } = await database.from("oauth_login_attempts").insert({
    provider: params.provider,
    state_hash: hashOAuthSecret(state),
    verifier_ciphertext: encryptOAuthSecret(codeVerifier),
    nonce_ciphertext: nonce ? encryptOAuthSecret(nonce) : null,
    intent: params.intent,
    linking_user_id: params.intent === "link" ? customer?.customerId ?? null : null,
    redirect_to: sanitizeSocialRedirect(params.redirectTo),
    expires_at: new Date(Date.now() + OAUTH_TTL_MS).toISOString(),
    ip_hash: forwardedFor ? hashPrivacyValue(forwardedFor) : null,
    user_agent_short: (requestHeaders.get("user-agent") ?? "").slice(0, 255) || null
  });
  if (error) throw new Error("Не удалось начать безопасный вход.");

  const cookieStore = await cookies();
  cookieStore.set(`${OAUTH_COOKIE_PREFIX}${params.provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/api/auth/social",
    maxAge: Math.floor(OAUTH_TTL_MS / 1000)
  });

  return { state, codeVerifier, nonce, codeChallenge: sha256Base64Url(codeVerifier) };
}

export async function consumeOAuthAttempt(provider: SocialProvider, returnedState: string) {
  const cookieStore = await cookies();
  const cookieName = `${OAUTH_COOKIE_PREFIX}${provider}`;
  const cookieState = cookieStore.get(cookieName)?.value ?? "";
  cookieStore.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/api/auth/social",
    maxAge: 0
  });

  if (!cookieState || !returnedState || !safeSecretEqual(cookieState, returnedState)) {
    throw new Error("Сессия авторизации не совпадает. Начните вход заново.");
  }

  const sql = getPostgresSql();
  const [attempt] = await sql<{
    provider: SocialProvider;
    verifier_ciphertext: string;
    nonce_ciphertext: string | null;
    intent: "login" | "link";
    linking_user_id: string | null;
    redirect_to: string | null;
  }[]>`
    update public.oauth_login_attempts
    set consumed_at = now()
    where provider = ${provider}
      and state_hash = ${hashOAuthSecret(returnedState)}
      and consumed_at is null
      and expires_at > now()
    returning provider, verifier_ciphertext, nonce_ciphertext, intent, linking_user_id, redirect_to
  `;
  if (!attempt) throw new Error("Сессия авторизации истекла или уже использована.");

  return {
    provider: attempt.provider,
    state: returnedState,
    codeVerifier: decryptOAuthSecret(attempt.verifier_ciphertext),
    nonce: attempt.nonce_ciphertext ? decryptOAuthSecret(attempt.nonce_ciphertext) : null,
    intent: attempt.intent,
    linkingUserId: attempt.linking_user_id,
    redirectTo: sanitizeSocialRedirect(attempt.redirect_to)
  } satisfies ConsumedOAuthAttempt;
}

export async function createPendingSocialIdentity(claims: SocialIdentityClaims, redirectTo: string) {
  const ticket = randomBase64Url();
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");
  const { error } = await database.from("pending_social_identities").insert({
    ticket_hash: hashOAuthSecret(ticket),
    provider: claims.provider,
    provider_user_id: claims.providerUserId,
    claims,
    redirect_to: sanitizeSocialRedirect(redirectTo),
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString()
  });
  if (error) throw new Error("Не удалось продолжить привязку аккаунта.");

  const cookieStore = await cookies();
  cookieStore.set(PENDING_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: Math.floor(PENDING_TTL_MS / 1000)
  });
}

export async function readPendingSocialIdentity() {
  const ticket = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!ticket) return null;
  const database = createDatabaseServerClient();
  if (!database) return null;
  const { data } = await database
    .from("pending_social_identities")
    .select("provider, provider_user_id, claims, redirect_to, expires_at")
    .eq("ticket_hash", hashOAuthSecret(ticket))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    provider: SocialProvider;
    provider_user_id: string;
    claims: unknown;
    redirect_to: string | null;
    expires_at: string;
  };
  return { ticket, ...row };
}

export async function clearPendingSocialIdentityCookie() {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 0
  });
}

export { sanitizeSocialRedirect } from "./redirect";
