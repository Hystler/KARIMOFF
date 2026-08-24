import "server-only";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getCustomerSession } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { hashPrivacyValue } from "@/lib/legal-consents";
import { getPostgresSql } from "@/lib/postgres/server";
import {
  decryptOAuthSecret,
  encryptOAuthSecret,
  hashOAuthSecret,
  randomBase64Url
} from "./crypto";
import { SocialAuthError } from "./errors";
import type { SocialCompletionAttempt } from "./identity";
import { sanitizeSocialRedirect } from "./redirect";
import type { SocialIdentityClaims, SocialProvider } from "./types";

const OAUTH_TTL_MS = 10 * 60_000;
const OAUTH_PROCESSING_LEASE_SECONDS = 30;
const PENDING_TTL_MS = 15 * 60_000;
const OAUTH_COOKIE_PREFIX = "karimoff_oauth_state_";
const PENDING_COOKIE = "karimoff_social_pending";

type TelegramAttemptStatus = "pending" | "provider_verified" | "completed" | "failed";
type TelegramCompletionResult = "authenticated" | "linked" | "needs_phone";

type TelegramAttemptRow = {
  id: string;
  provider: "telegram";
  verifier_ciphertext: string;
  nonce_ciphertext: string | null;
  intent: "login" | "link";
  linking_user_id: string | null;
  redirect_to: string | null;
  status: TelegramAttemptStatus;
  identity_ciphertext: string | null;
  expires_at: Date;
  processing_at: Date | null;
  browser_consumed_at: Date | null;
  completion_result: TelegramCompletionResult | null;
  resolved_user_id: string | null;
};

function secureCookie() {
  return process.env.NODE_ENV === "production";
}

function telegramCookieName() {
  return `${OAUTH_COOKIE_PREFIX}telegram`;
}

function parseTelegramBrowserCookie(value: string | undefined) {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  const attemptId = value.slice(0, separator);
  const binding = value.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[A-Za-z0-9_-]{43,128}$/.test(binding)) return null;
  return { attemptId, binding };
}

async function requireTelegramBrowserBinding(attemptId: string) {
  const browser = parseTelegramBrowserCookie((await cookies()).get(telegramCookieName())?.value);
  if (!browser || browser.attemptId !== attemptId) {
    throw new SocialAuthError({ code: "browser_binding_mismatch", stage: "state" });
  }
  return browser;
}

function classifyTelegramAttempt(row: Pick<TelegramAttemptRow, "expires_at" | "status" | "browser_consumed_at"> | undefined) {
  if (!row) throw new SocialAuthError({ code: "state_not_found", stage: "state" });
  if (row.expires_at.getTime() <= Date.now()) {
    throw new SocialAuthError({ code: "expired_state", stage: "state" });
  }
  if (row.browser_consumed_at || row.status === "completed") {
    throw new SocialAuthError({ code: "state_replay", stage: "state" });
  }
  throw new SocialAuthError({ code: "state_invalid", stage: "state" });
}

export async function createOAuthAttempt(params: {
  provider: "telegram";
  intent: "login" | "link";
  redirectTo?: string | null;
}) {
  const customer = await getCustomerSession();
  if (params.intent === "link" && !customer) throw new Error("Сначала войдите в профиль.");

  const attemptId = randomUUID();
  const browserBinding = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const sql = getPostgresSql();

  await sql`
    delete from public.oauth_login_attempts
    where expires_at < now() - interval '1 day'
  `;

  await sql`
    insert into public.oauth_login_attempts (
      id, provider, state_hash, verifier_ciphertext, nonce_ciphertext, intent,
      linking_user_id, redirect_to, expires_at, status, ip_hash, user_agent_short
    )
    values (
      ${attemptId}::uuid, ${params.provider}, ${hashOAuthSecret(browserBinding)},
      ${encryptOAuthSecret(randomBase64Url(48))}, ${encryptOAuthSecret(nonce)}, ${params.intent},
      ${params.intent === "link" ? customer?.customerId ?? null : null}::uuid,
      ${sanitizeSocialRedirect(params.redirectTo)}, ${new Date(Date.now() + OAUTH_TTL_MS)},
      'pending', ${forwardedFor ? hashPrivacyValue(forwardedFor) : null},
      ${(requestHeaders.get("user-agent") ?? "").slice(0, 255) || null}
    )
  `;

  const cookieStore = await cookies();
  cookieStore.set(telegramCookieName(), `${attemptId}.${browserBinding}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: Math.floor(OAUTH_TTL_MS / 1000)
  });

  return {
    attemptId,
    expiresInSeconds: Math.floor(OAUTH_TTL_MS / 1000),
    nonce,
    redirectTo: sanitizeSocialRedirect(params.redirectTo)
  };
}

export async function getTelegramProviderVerificationAttempt(attemptId: string) {
  const browser = await requireTelegramBrowserBinding(attemptId);
  const sql = getPostgresSql();
  const [attempt] = await sql<TelegramAttemptRow[]>`
    select id, provider, verifier_ciphertext, nonce_ciphertext, intent, linking_user_id,
           redirect_to, status, identity_ciphertext, expires_at, processing_at,
           browser_consumed_at, completion_result, resolved_user_id
    from public.oauth_login_attempts
    where id = ${attemptId}::uuid
      and provider = 'telegram'
      and state_hash = ${hashOAuthSecret(browser.binding)}
  `;
  if (!attempt) throw new SocialAuthError({ code: "browser_binding_mismatch", stage: "state" });
  if (attempt.expires_at.getTime() <= Date.now()) {
    throw new SocialAuthError({ code: "expired_state", stage: "state" });
  }
  if (attempt.status !== "pending" || attempt.browser_consumed_at) {
    throw new SocialAuthError({ code: "state_replay", stage: "state" });
  }
  if (!attempt.nonce_ciphertext) {
    throw new SocialAuthError({ code: "state_invalid", stage: "state" });
  }
  try {
    return { id: attempt.id, nonce: decryptOAuthSecret(attempt.nonce_ciphertext) };
  } catch (error) {
    throw new SocialAuthError({ code: "state_invalid", stage: "state", cause: error });
  }
}

export async function completeTelegramProviderAttempt(attemptId: string, claims: SocialIdentityClaims) {
  const browser = await requireTelegramBrowserBinding(attemptId);
  const identityCiphertext = encryptOAuthSecret(JSON.stringify(claims));
  const sql = getPostgresSql();

  return sql.begin(async (transaction) => {
    const [verified] = await transaction<Pick<TelegramAttemptRow, "id">[]>`
      update public.oauth_login_attempts
      set status = 'provider_verified', provider_verified_at = now(), updated_at = now()
      where id = ${attemptId}::uuid
        and provider = 'telegram'
        and state_hash = ${hashOAuthSecret(browser.binding)}
        and status = 'pending'
        and browser_consumed_at is null
        and expires_at > now()
      returning id
    `;
    if (!verified) {
      const [existing] = await transaction<Pick<TelegramAttemptRow, "expires_at" | "status" | "browser_consumed_at">[]>`
        select expires_at, status, browser_consumed_at
        from public.oauth_login_attempts
        where id = ${attemptId}::uuid
          and provider = 'telegram'
          and state_hash = ${hashOAuthSecret(browser.binding)}
      `;
      return classifyTelegramAttempt(existing);
    }

    const [completed] = await transaction<Pick<TelegramAttemptRow, "id">[]>`
      update public.oauth_login_attempts
      set status = 'completed', identity_ciphertext = ${identityCiphertext},
          completed_at = now(), last_error_code = null, updated_at = now()
      where id = ${attemptId}::uuid and status = 'provider_verified'
      returning id
    `;
    if (!completed) throw new SocialAuthError({ code: "state_invalid", stage: "state" });
    return { attemptId: completed.id };
  });
}

export async function getTelegramBrowserAttemptStatus(attemptId: string) {
  const browser = await requireTelegramBrowserBinding(attemptId);
  const sql = getPostgresSql();
  const [attempt] = await sql<Pick<TelegramAttemptRow, "id" | "status" | "expires_at" | "browser_consumed_at">[]>`
    select id, status, expires_at, browser_consumed_at
    from public.oauth_login_attempts
    where id = ${attemptId}::uuid
      and provider = 'telegram'
      and state_hash = ${hashOAuthSecret(browser.binding)}
  `;
  if (!attempt) throw new SocialAuthError({ code: "browser_binding_mismatch", stage: "state" });
  if (attempt.expires_at.getTime() <= Date.now()) {
    return { correlationId: attempt.id, status: "expired" as const };
  }
  if (attempt.status === "failed") {
    return { correlationId: attempt.id, status: "failed" as const };
  }
  return {
    correlationId: attempt.id,
    status: attempt.status === "completed" || Boolean(attempt.browser_consumed_at)
      ? "completed" as const
      : "pending" as const
  };
}

export async function getResumableTelegramAttempt(attemptId: string) {
  const result = await getTelegramBrowserAttemptStatus(attemptId);
  const sql = getPostgresSql();
  const [attempt] = await sql<Pick<TelegramAttemptRow, "expires_at">[]>`
    select expires_at
    from public.oauth_login_attempts
    where id = ${attemptId}::uuid and provider = 'telegram'
  `;
  if (!attempt || result.status === "expired") return null;
  return {
    attemptId,
    expiresInSeconds: Math.max(1, Math.floor((attempt.expires_at.getTime() - Date.now()) / 1000)),
    status: result.status
  };
}

export type ClaimedTelegramAttempt = {
  attemptId: string;
  correlationId: string;
  claims: SocialIdentityClaims;
  completion: SocialCompletionAttempt;
  preparedResult: TelegramCompletionResult | null;
  resolvedUserId: string | null;
};

export async function claimCompletedTelegramAttempt(attemptId: string) {
  const browser = await requireTelegramBrowserBinding(attemptId);
  const sql = getPostgresSql();
  const [claimed] = await sql<TelegramAttemptRow[]>`
    update public.oauth_login_attempts
    set processing_at = now(), updated_at = now()
    where id = ${attemptId}::uuid
      and provider = 'telegram'
      and state_hash = ${hashOAuthSecret(browser.binding)}
      and status = 'completed'
      and identity_ciphertext is not null
      and browser_consumed_at is null
      and expires_at > now()
      and (processing_at is null or processing_at < now() - make_interval(secs => ${OAUTH_PROCESSING_LEASE_SECONDS}))
    returning id, provider, verifier_ciphertext, nonce_ciphertext, intent, linking_user_id,
              redirect_to, status, identity_ciphertext, expires_at, processing_at,
              browser_consumed_at, completion_result, resolved_user_id
  `;
  if (claimed?.identity_ciphertext) {
    try {
      return {
        attemptId: claimed.id,
        correlationId: claimed.id,
        claims: JSON.parse(decryptOAuthSecret(claimed.identity_ciphertext)) as SocialIdentityClaims,
        completion: {
          intent: claimed.intent,
          linkingUserId: claimed.linking_user_id,
          redirectTo: sanitizeSocialRedirect(claimed.redirect_to)
        },
        preparedResult: claimed.completion_result,
        resolvedUserId: claimed.resolved_user_id
      } satisfies ClaimedTelegramAttempt;
    } catch (error) {
      await releaseTelegramAttemptClaim(claimed.id, "identity_payload_invalid");
      throw new SocialAuthError({ code: "state_invalid", stage: "state", cause: error });
    }
  }

  const [existing] = await sql<TelegramAttemptRow[]>`
    select id, provider, verifier_ciphertext, nonce_ciphertext, intent, linking_user_id,
           redirect_to, status, identity_ciphertext, expires_at, processing_at,
           browser_consumed_at, completion_result, resolved_user_id
    from public.oauth_login_attempts
    where id = ${attemptId}::uuid
      and provider = 'telegram'
      and state_hash = ${hashOAuthSecret(browser.binding)}
  `;
  if (!existing) throw new SocialAuthError({ code: "browser_binding_mismatch", stage: "state" });
  if (existing.expires_at.getTime() <= Date.now()) {
    throw new SocialAuthError({ code: "expired_state", stage: "state" });
  }
  if (existing.browser_consumed_at) {
    return {
      kind: "consumed" as const,
      correlationId: existing.id,
      completionResult: existing.completion_result,
      redirectTo: sanitizeSocialRedirect(existing.redirect_to)
    };
  }
  return {
    kind: existing.status === "failed" ? "failed" as const : "waiting" as const,
    correlationId: existing.id
  };
}

export async function markTelegramAttemptPrepared(
  attemptId: string,
  result: TelegramCompletionResult,
  resolvedUserId: string | null
) {
  if (result !== "needs_phone" && !resolvedUserId) {
    throw new SocialAuthError({ code: "session_failed", stage: "session" });
  }
  const sql = getPostgresSql();
  await sql`
    update public.oauth_login_attempts
    set completion_result = coalesce(completion_result, ${result}),
        resolved_user_id = coalesce(resolved_user_id, ${resolvedUserId}::uuid),
        processing_at = null,
        updated_at = now()
    where id = ${attemptId}::uuid and provider = 'telegram'
  `;
}

export async function releaseTelegramAttemptClaim(attemptId: string, errorCode: string) {
  const sql = getPostgresSql();
  await sql`
    update public.oauth_login_attempts
    set processing_at = null, last_error_code = ${errorCode.slice(0, 80)}, updated_at = now()
    where id = ${attemptId}::uuid and provider = 'telegram'
  `;
}

export async function acknowledgeTelegramAttempt(
  attemptId: string,
  proof: {
    sessionUserId: string | null;
    pendingIdentity: { provider: SocialProvider; providerUserId: string } | null;
  }
) {
  const browser = await requireTelegramBrowserBinding(attemptId);
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const [attempt] = await transaction<TelegramAttemptRow[]>`
      select id, provider, verifier_ciphertext, nonce_ciphertext, intent, linking_user_id,
             redirect_to, status, identity_ciphertext, expires_at, processing_at,
             browser_consumed_at, completion_result, resolved_user_id
      from public.oauth_login_attempts
      where id = ${attemptId}::uuid
        and provider = 'telegram'
        and state_hash = ${hashOAuthSecret(browser.binding)}
      for update
    `;
    if (!attempt || attempt.status !== "completed" || !attempt.completion_result) {
      throw new SocialAuthError({ code: "state_replay", stage: "state" });
    }
    if (attempt.expires_at.getTime() <= Date.now()) {
      throw new SocialAuthError({ code: "expired_state", stage: "state" });
    }

    if (attempt.completion_result === "needs_phone") {
      if (!proof.pendingIdentity) {
        throw new SocialAuthError({ code: "session_failed", stage: "session" });
      }
      if (attempt.identity_ciphertext) {
        const claims = JSON.parse(decryptOAuthSecret(attempt.identity_ciphertext)) as SocialIdentityClaims;
        if (
          proof.pendingIdentity.provider !== claims.provider
          || proof.pendingIdentity.providerUserId !== claims.providerUserId
        ) {
          throw new SocialAuthError({ code: "session_failed", stage: "session" });
        }
      }
    } else if (!attempt.resolved_user_id || proof.sessionUserId !== attempt.resolved_user_id) {
      throw new SocialAuthError({ code: "session_failed", stage: "session" });
    }

    const [acknowledged] = await transaction<Pick<TelegramAttemptRow, "id" | "redirect_to" | "completion_result">[]>`
      update public.oauth_login_attempts
      set identity_ciphertext = null,
          browser_consumed_at = coalesce(browser_consumed_at, now()),
          consumed_at = coalesce(consumed_at, now()),
          processing_at = null,
          updated_at = now()
      where id = ${attemptId}::uuid
      returning id, redirect_to, completion_result
    `;
    if (!acknowledged) throw new SocialAuthError({ code: "state_replay", stage: "state" });
    return {
      correlationId: acknowledged.id,
      completionResult: acknowledged.completion_result,
      redirectTo: sanitizeSocialRedirect(acknowledged.redirect_to)
    };
  });
}

export async function clearTelegramAttemptCookie() {
  const cookieStore = await cookies();
  cookieStore.set(telegramCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 0
  });
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
