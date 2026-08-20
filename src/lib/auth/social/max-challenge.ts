import "server-only";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getCustomerSession } from "@/lib/customer-auth";
import { hashPrivacyValue } from "@/lib/legal-consents";
import { getPostgresSql } from "@/lib/postgres/server";
import { decryptOAuthSecret, encryptOAuthSecret, hashOAuthSecret, randomBase64Url } from "./crypto";
import { sanitizeSocialRedirect } from "./redirect";
import type { SocialCompletionAttempt } from "./identity";
import type { SocialIdentityClaims } from "./types";

const MAX_CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGE_COOKIE = "karimoff_max_login";
const PROCESSING_LEASE_SECONDS = 30;

export type MaxChallengeErrorCode =
  | "browser_binding_mismatch"
  | "challenge_expired"
  | "challenge_invalid"
  | "challenge_replay"
  | "challenge_unavailable";

export class MaxChallengeError extends Error {
  readonly code: MaxChallengeErrorCode;

  constructor(code: MaxChallengeErrorCode) {
    super(code);
    this.name = "MaxChallengeError";
    this.code = code;
  }
}

type MaxChallengeRow = {
  id: string;
  correlation_id: string;
  intent: "login" | "link";
  linking_user_id: string | null;
  redirect_to: string;
  status: "pending" | "awaiting_phone" | "completed" | "failed";
  identity_ciphertext: string | null;
  expires_at: Date;
  completed_at: Date | null;
  processing_at: Date | null;
  used_at: Date | null;
};

function secureCookie() {
  return process.env.NODE_ENV === "production";
}

function parseBrowserCookie(value: string | undefined) {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  const attemptId = value.slice(0, separator);
  const binding = value.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[A-Za-z0-9_-]{43,128}$/.test(binding)) return null;
  return { attemptId, binding };
}

export async function createMaxLoginChallenge(params: {
  intent: "login" | "link";
  redirectTo?: string | null;
}) {
  const current = await getCustomerSession();
  if (params.intent === "link" && !current) throw new MaxChallengeError("challenge_unavailable");

  const id = randomUUID();
  const correlationId = randomUUID();
  const challenge = randomBase64Url(32);
  const browserBinding = randomBase64Url(32);
  const redirectTo = sanitizeSocialRedirect(params.redirectTo);
  const expiresAt = new Date(Date.now() + MAX_CHALLENGE_TTL_MS);
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const sql = getPostgresSql();

  await sql`
    delete from public.max_login_challenges
    where expires_at < now() - interval '1 day'
  `;

  await sql`
    insert into public.max_login_challenges (
      id, correlation_id, challenge_hash, browser_binding_hash, intent,
      linking_user_id, redirect_to, expires_at, ip_hash, user_agent_short
    )
    values (
      ${id}::uuid, ${correlationId}::uuid, ${hashOAuthSecret(challenge)},
      ${hashOAuthSecret(browserBinding)}, ${params.intent},
      ${params.intent === "link" ? current?.customerId ?? null : null}::uuid,
      ${redirectTo}, ${expiresAt}, ${forwardedFor ? hashPrivacyValue(forwardedFor) : null},
      ${(requestHeaders.get("user-agent") ?? "").slice(0, 255) || null}
    )
  `;

  const cookieStore = await cookies();
  cookieStore.set(MAX_CHALLENGE_COOKIE, `${id}.${browserBinding}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: Math.floor(MAX_CHALLENGE_TTL_MS / 1000)
  });

  return {
    attemptId: id,
    challenge,
    correlationId,
    expiresInSeconds: Math.floor(MAX_CHALLENGE_TTL_MS / 1000),
    redirectTo
  };
}

export async function completeMaxLoginChallenge(params: {
  challenge: string;
  claims: SocialIdentityClaims;
  contactDecision: "not_requested" | "provided" | "denied";
}) {
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const [challenge] = await transaction<MaxChallengeRow[]>`
      select id, correlation_id, intent, linking_user_id, redirect_to, status,
             identity_ciphertext, expires_at, completed_at, processing_at, used_at
      from public.max_login_challenges
      where challenge_hash = ${hashOAuthSecret(params.challenge)}
      for update
    `;
    if (!challenge) throw new MaxChallengeError("challenge_invalid");
    if (challenge.expires_at.getTime() <= Date.now()) throw new MaxChallengeError("challenge_expired");
    if (challenge.used_at) throw new MaxChallengeError("challenge_replay");
    if (challenge.status === "failed") throw new MaxChallengeError("challenge_invalid");
    if (challenge.status === "completed") throw new MaxChallengeError("challenge_replay");

    const [existingIdentity] = await transaction<{ exists: boolean }[]>`
      select exists (
        select 1
        from public.user_identities
        where provider = 'max'
          and provider_user_id = ${params.claims.providerUserId}
      ) as exists
    `;
    const canCompleteWithoutPhone = challenge.intent === "link" || Boolean(existingIdentity?.exists);
    if (!canCompleteWithoutPhone && !params.claims.phoneVerified && params.contactDecision === "not_requested") {
      await transaction`
        update public.max_login_challenges
        set status = 'awaiting_phone', last_error_code = null, updated_at = now()
        where id = ${challenge.id}::uuid
      `;
      return { kind: "needs_contact" as const, correlationId: challenge.correlation_id };
    }

    await transaction`
      update public.max_login_challenges
      set status = 'completed',
          identity_ciphertext = ${encryptOAuthSecret(JSON.stringify(params.claims))},
          completed_at = coalesce(completed_at, now()),
          last_error_code = null,
          updated_at = now()
      where id = ${challenge.id}::uuid
    `;
    return { kind: "completed" as const, correlationId: challenge.correlation_id };
  });
}

export type ClaimedMaxChallenge = {
  attemptId: string;
  correlationId: string;
  claims: SocialIdentityClaims;
  completion: SocialCompletionAttempt;
};

export async function claimCompletedMaxChallenge(attemptId: string) {
  const cookieStore = await cookies();
  const browser = parseBrowserCookie(cookieStore.get(MAX_CHALLENGE_COOKIE)?.value);
  if (!browser || browser.attemptId !== attemptId) {
    throw new MaxChallengeError("browser_binding_mismatch");
  }
  const sql = getPostgresSql();
  const [claimed] = await sql<MaxChallengeRow[]>`
    update public.max_login_challenges
    set processing_at = now(), updated_at = now()
    where id = ${attemptId}::uuid
      and browser_binding_hash = ${hashOAuthSecret(browser.binding)}
      and status = 'completed'
      and identity_ciphertext is not null
      and used_at is null
      and expires_at > now()
      and (processing_at is null or processing_at < now() - make_interval(secs => ${PROCESSING_LEASE_SECONDS}))
    returning id, correlation_id, intent, linking_user_id, redirect_to, status,
              identity_ciphertext, expires_at, completed_at, processing_at, used_at
  `;
  if (claimed?.identity_ciphertext) {
    try {
      return {
        attemptId: claimed.id,
        correlationId: claimed.correlation_id,
        claims: JSON.parse(decryptOAuthSecret(claimed.identity_ciphertext)) as SocialIdentityClaims,
        completion: {
          intent: claimed.intent,
          linkingUserId: claimed.linking_user_id,
          redirectTo: sanitizeSocialRedirect(claimed.redirect_to)
        }
      } satisfies ClaimedMaxChallenge;
    } catch {
      await releaseMaxChallengeClaim(claimed.id, "identity_payload_invalid");
      throw new MaxChallengeError("challenge_invalid");
    }
  }

  const [existing] = await sql<MaxChallengeRow[]>`
    select id, correlation_id, intent, linking_user_id, redirect_to, status,
           identity_ciphertext, expires_at, completed_at, processing_at, used_at
    from public.max_login_challenges
    where id = ${attemptId}::uuid
      and browser_binding_hash = ${hashOAuthSecret(browser.binding)}
  `;
  if (!existing) throw new MaxChallengeError("browser_binding_mismatch");
  if (existing.expires_at.getTime() <= Date.now()) throw new MaxChallengeError("challenge_expired");
  if (existing.used_at) {
    return {
      kind: "consumed" as const,
      correlationId: existing.correlation_id,
      redirectTo: sanitizeSocialRedirect(existing.redirect_to)
    };
  }
  return {
    kind: existing.status === "failed" ? "failed" as const : "waiting" as const,
    correlationId: existing.correlation_id
  };
}

export async function getResumableMaxChallenge() {
  const browser = parseBrowserCookie((await cookies()).get(MAX_CHALLENGE_COOKIE)?.value);
  if (!browser) return null;
  const sql = getPostgresSql();
  const [challenge] = await sql<Pick<MaxChallengeRow, "id" | "status" | "expires_at" | "used_at">[]>`
    select id, status, expires_at, used_at
    from public.max_login_challenges
    where id = ${browser.attemptId}::uuid
      and browser_binding_hash = ${hashOAuthSecret(browser.binding)}
  `;
  if (!challenge || challenge.used_at || challenge.expires_at.getTime() <= Date.now()) return null;
  return {
    attemptId: challenge.id,
    expiresInSeconds: Math.max(1, Math.floor((challenge.expires_at.getTime() - Date.now()) / 1000)),
    status: challenge.status
  };
}

export async function markMaxChallengeConsumed(attemptId: string) {
  const sql = getPostgresSql();
  await sql`
    update public.max_login_challenges
    set used_at = now(), processing_at = null, identity_ciphertext = null, updated_at = now()
    where id = ${attemptId}::uuid and used_at is null
  `;
}

export async function releaseMaxChallengeClaim(attemptId: string, errorCode: string) {
  const sql = getPostgresSql();
  await sql`
    update public.max_login_challenges
    set processing_at = null, last_error_code = ${errorCode.slice(0, 80)}, updated_at = now()
    where id = ${attemptId}::uuid and used_at is null
  `;
}

export async function clearMaxChallengeCookie() {
  const cookieStore = await cookies();
  cookieStore.set(MAX_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 0
  });
}
