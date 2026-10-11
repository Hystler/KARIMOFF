import "server-only";

import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { clearCustomerSession, getCustomerSession, setCustomerSession } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { hashPrivacyValue } from "@/lib/legal-consents";
import { getPostgresSql } from "@/lib/postgres/server";
import { LEGAL_VERSION } from "@/lib/legal";
import { hashOAuthSecret } from "./crypto";
import { SocialAuthError } from "./errors";
import { resolveVerifiedSocialIdentity } from "./linking-rules";
import { createPendingSocialIdentity } from "./state";
import type { SocialIdentityClaims, SocialProvider } from "./types";

const claimsSchema = z.object({
  provider: z.enum(["telegram", "max"]),
  providerUserId: z.string().min(1).max(255),
  displayName: z.string().max(160).nullable(),
  phone: z.string().regex(/^\+7\d{10}$/).nullable(),
  phoneVerified: z.boolean(),
  telegramBotUserId: z.string().regex(/^[1-9]\d{0,15}$/).nullable().optional()
});

export type UserIdentityView = {
  id: string;
  provider: "phone" | SocialProvider;
  phoneVerified: boolean;
  linkedAt: string;
  lastLoginAt: string | null;
  telegramBotUserIdPresent?: boolean;
};

export type SocialCompletionAttempt = {
  intent: "login" | "link";
  linkingUserId: string | null;
  redirectTo: string;
};

export async function bindIdentityToUser(userId: string, rawClaims: SocialIdentityClaims) {
  const claims = claimsSchema.parse(rawClaims);
  const sql = getPostgresSql();
  await sql.begin(async (transaction) => {
    const [providerIdentity] = await transaction<{ user_id: string }[]>`
      select user_id
      from public.user_identities
      where provider = ${claims.provider}
        and provider_user_id = ${claims.providerUserId}
      for update
    `;
    if (providerIdentity && providerIdentity.user_id !== userId) {
      throw new SocialAuthError({ code: "identity_conflict", stage: "identity" });
    }

    const [userProviderIdentity] = await transaction<{ provider_user_id: string }[]>`
      select provider_user_id
      from public.user_identities
      where user_id = ${userId}::uuid
        and provider = ${claims.provider}
      for update
    `;
    if (userProviderIdentity && userProviderIdentity.provider_user_id !== claims.providerUserId) {
      throw new SocialAuthError({ code: "identity_conflict", stage: "identity" });
    }

    await transaction`
      insert into public.user_identities (
        user_id, provider, provider_user_id, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId},
        ${claims.phoneVerified}, now(), now(),
        ${transaction.json(claims.telegramBotUserId ? { telegramBotUserId: claims.telegramBotUserId } : {})}
      )
      on conflict (provider, provider_user_id) do update
      set username = null,
          display_name = null,
          avatar_url = null,
          email = null,
          phone = null,
          metadata = excluded.metadata,
          phone_verified = excluded.phone_verified,
          last_login_at = now(),
          updated_at = now()
      where public.user_identities.user_id = excluded.user_id
    `;
    await transaction`update public.customers set last_login_at = now(), updated_at = now() where id = ${userId}::uuid`;
  });
}

async function resolveLoginIdentity(claims: SocialIdentityClaims) {
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${`social:${claims.provider}:${claims.providerUserId}`}, 0)
      )
    `;
    if (claims.phone) {
      await transaction`
        select pg_advisory_xact_lock(hashtextextended(${`phone:${claims.phone}`}, 0))
      `;
    }

    const [existingIdentity] = await transaction<{ user_id: string }[]>`
      select user_id
      from public.user_identities
      where provider = ${claims.provider}
        and provider_user_id = ${claims.providerUserId}
      for update
    `;

    let userId = existingIdentity?.user_id ?? null;
    if (!userId) {
      const [phoneOwner] = claims.phone ? await transaction<{ id: string; phone_verified_at: Date | null }[]>`
        select id, phone_verified_at
        from public.customers
        where phone = ${claims.phone}
        for update
      ` : [];
      if (claims.provider === "max" && phoneOwner && !phoneOwner.phone_verified_at) {
        return null;
      }
      const resolution = resolveVerifiedSocialIdentity({
        existingIdentityUserId: null,
        providerPhone: claims.phone,
        providerPhoneVerified: claims.phoneVerified,
        phoneOwner: phoneOwner ? { userId: phoneOwner.id, verified: Boolean(phoneOwner.phone_verified_at) } : null
      });
      if (resolution.kind === "needs_phone_confirmation") return null;

      if (resolution.kind === "verified_phone") {
        userId = resolution.userId;
      } else if (resolution.kind === "create_customer") {
        const customerName = claims.displayName?.trim() || (claims.provider === "telegram" ? "Пользователь Telegram" : "Пользователь MAX");
        try {
          const [created] = await transaction<{ id: string }[]>`
            insert into public.customers (name, phone, phone_verified_at, last_login_at)
            values (${customerName}, ${claims.phone}, now(), now())
            returning id
          `;
          userId = created?.id ?? null;
        } catch (error) {
          throw new SocialAuthError({ code: "identity_failed", stage: "identity", cause: error });
        }
      }
    }

    if (!userId) return null;
    const [differentProviderIdentity] = await transaction<{ provider_user_id: string }[]>`
      select provider_user_id
      from public.user_identities
      where user_id = ${userId}::uuid
        and provider = ${claims.provider}
        and provider_user_id <> ${claims.providerUserId}
      for update
    `;
    if (differentProviderIdentity) {
      throw new SocialAuthError({ code: "identity_conflict", stage: "identity" });
    }

    await transaction`
      insert into public.user_identities (
        user_id, provider, provider_user_id, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId},
        ${claims.phoneVerified}, now(), now(),
        ${transaction.json(claims.telegramBotUserId ? { telegramBotUserId: claims.telegramBotUserId } : {})}
      )
      on conflict (provider, provider_user_id) do update
      set username = null,
          display_name = null,
          avatar_url = null,
          email = null,
          phone = null,
          metadata = excluded.metadata,
          phone_verified = excluded.phone_verified,
          last_login_at = now(),
          updated_at = now()
      where public.user_identities.user_id = excluded.user_id
    `;

    if (claims.phoneVerified && claims.phone) {
      await transaction`
        insert into public.user_identities (
          user_id, provider, provider_user_id, display_name, phone, phone_verified,
          linked_at, last_login_at, metadata
        )
        values (
          ${userId}::uuid, 'phone', ${claims.phone}, ${claims.displayName}, ${claims.phone},
          true, now(), now(), '{}'::jsonb
        )
        on conflict (provider, provider_user_id) do update
        set phone_verified = true,
            last_login_at = now(),
            updated_at = now()
        where public.user_identities.user_id = excluded.user_id
      `;
    }

    await transaction`
      update public.customers
      set phone_verified_at = case
            when ${claims.phoneVerified} and phone = ${claims.phone} then coalesce(phone_verified_at, now())
            else phone_verified_at
          end,
          last_login_at = now(),
          updated_at = now()
      where id = ${userId}::uuid
    `;
    return userId;
  });
}

export async function completeProviderCallback(
  rawClaims: SocialIdentityClaims,
  attempt: SocialCompletionAttempt,
  options?: { sourcePath?: string }
) {
  const claims = claimsSchema.parse(rawClaims);
  const sourcePath = options?.sourcePath ?? `/api/auth/social/${claims.provider}/callback`;

  if (attempt.intent === "link") {
    const current = await getCustomerSession();
    if (!current || !attempt.linkingUserId || current.customerId !== attempt.linkingUserId) {
      throw new Error("Сессия привязки изменилась. Войдите и повторите попытку.");
    }
    await bindIdentityToUser(current.customerId, claims);
    await writeAuditLog({
      action: "customer.identity_linked",
      actorId: current.customerId,
      actorType: "customer",
      entityId: current.customerId,
      entityType: "customer",
      metadata: { provider: claims.provider },
      sourcePath
    }).catch(() => undefined);
    return { kind: "linked" as const, redirectTo: attempt.redirectTo };
  }

  const userId = await resolveLoginIdentity(claims);

  if (userId) {
    await setCustomerSession(userId);
    const session = await getCustomerSession();
    if (!session || session.customerId !== userId) {
      await clearCustomerSession();
      throw new SocialAuthError({ code: "session_failed", stage: "session" });
    }
    await writeAuditLog({
      action: "customer.social_login",
      actorId: userId,
      actorRefHash: hashPrivacyValue(`${claims.provider}:${claims.providerUserId}`),
      actorType: "customer",
      entityId: userId,
      entityType: "customer",
      metadata: { provider: claims.provider },
      sourcePath
    }).catch(() => undefined);
    return { kind: "authenticated" as const, redirectTo: attempt.redirectTo };
  }

  await createPendingSocialIdentity(claims, attempt.redirectTo);
  return { kind: "needs_phone" as const, redirectTo: "/login/social/complete" };
}

export async function getUserIdentities(userId: string): Promise<UserIdentityView[]> {
  const database = createDatabaseServerClient();
  if (!database) return [];
  try {
    const sql = getPostgresSql();
    const rows = await sql<{
      id: string;
      provider: UserIdentityView["provider"];
      phone_verified: boolean;
      linked_at: string | Date;
      last_login_at: string | Date | null;
      telegram_bot_user_id_present: boolean;
    }[]>`
      select id::text as id, provider, phone_verified, linked_at::text as linked_at,
        last_login_at::text as last_login_at,
        case
          when coalesce(metadata->>'telegramBotUserId', '') ~ '^[1-9][0-9]{0,15}$'
          then (metadata->>'telegramBotUserId')::numeric <= 9007199254740991
          else false
        end as telegram_bot_user_id_present
      from public.user_identities
      where user_id = ${userId}::uuid and provider in ('phone', 'telegram', 'max')
      order by linked_at asc
    `;

    return rows.map((row) => ({
      id: String(row.id),
      provider: row.provider,
      phoneVerified: Boolean(row.phone_verified),
      linkedAt: String(row.linked_at),
      lastLoginAt: row.last_login_at === null ? null : String(row.last_login_at),
      ...(row.provider === "telegram"
        ? { telegramBotUserIdPresent: Boolean(row.telegram_bot_user_id_present) }
        : {})
    }));
  } catch {
    return [];
  }
}

export async function syncPhoneIdentity(params: {
  userId: string;
  phone: string;
  displayName: string | null;
  verified: boolean;
}) {
  const sql = getPostgresSql();
  await sql`
    insert into public.user_identities (
      user_id, provider, provider_user_id, display_name, phone, phone_verified,
      linked_at, last_login_at, metadata
    )
    values (
      ${params.userId}::uuid, 'phone', ${params.phone}, ${params.displayName}, ${params.phone},
      ${params.verified}, now(), now(), '{}'::jsonb
    )
    on conflict (provider, provider_user_id) do update
    set display_name = excluded.display_name,
        phone_verified = public.user_identities.phone_verified or excluded.phone_verified,
        last_login_at = now(),
        updated_at = now()
    where public.user_identities.user_id = excluded.user_id
  `;
}

export async function completePendingIdentityRegistration(params: {
  ticket: string;
  phone: string;
  name: string;
  marketingConsent: boolean;
  userAgent: string | null;
}) {
  const sql = getPostgresSql();
  const result = await sql.begin(async (transaction) => {
    const [pending] = await transaction<{
      provider: SocialProvider;
      provider_user_id: string;
      claims: unknown;
      redirect_to: string | null;
    }[]>`
      update public.pending_social_identities
      set consumed_at = now()
      where ticket_hash = ${hashOAuthSecret(params.ticket)}
        and consumed_at is null
        and expires_at > now()
      returning provider, provider_user_id, claims, redirect_to
    `;
    if (!pending) throw new Error("Сессия привязки истекла или уже использована.");
    const claims = claimsSchema.parse(pending.claims);

    const [existingIdentity] = await transaction<{ user_id: string }[]>`
      select user_id
      from public.user_identities
      where provider = ${claims.provider}
        and provider_user_id = ${claims.providerUserId}
      for update
    `;

    if (existingIdentity) {
      throw new Error("Этот способ входа уже был привязан. Начните вход заново.");
    }

    let userId: string;
    {
      const [customer] = await transaction<{ id: string }[]>`
        select id
        from public.customers
        where phone = ${params.phone}
        for update
      `;
      if (customer) {
        userId = customer.id;
        await transaction`
          update public.customers
          set phone_verified_at = coalesce(phone_verified_at, now()),
              last_login_at = now(),
              updated_at = now()
          where id = ${userId}::uuid
        `;
      } else {
        const [created] = await transaction<{ id: string }[]>`
          insert into public.customers (name, phone, phone_verified_at, last_login_at)
          values (${params.name}, ${params.phone}, now(), now())
          returning id
        `;
        if (!created) throw new Error("Не удалось создать профиль.");
        userId = created.id;
      }
    }

    const [differentProviderIdentity] = await transaction<{ provider_user_id: string }[]>`
      select provider_user_id
      from public.user_identities
      where user_id = ${userId}::uuid
        and provider = ${claims.provider}
        and provider_user_id <> ${claims.providerUserId}
      for update
    `;
    if (differentProviderIdentity) {
      throw new Error("К профилю уже привязан другой аккаунт этого сервиса.");
    }

    await transaction`
      insert into public.user_identities (
        user_id, provider, provider_user_id, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId},
        ${claims.phoneVerified}, now(), now(),
        ${transaction.json(claims.telegramBotUserId ? { telegramBotUserId: claims.telegramBotUserId } : {})}
      )
      on conflict (provider, provider_user_id) do update
      set username = null,
          display_name = null,
          avatar_url = null,
          email = null,
          phone = null,
          metadata = excluded.metadata,
          phone_verified = excluded.phone_verified,
          last_login_at = now(),
          updated_at = now()
      where public.user_identities.user_id = excluded.user_id
    `;
    await transaction`
      insert into public.user_identities (
        user_id, provider, provider_user_id, display_name, phone, phone_verified,
        linked_at, last_login_at, metadata
      )
      values (${userId}::uuid, 'phone', ${params.phone}, ${params.name}, ${params.phone}, true, now(), now(), '{}'::jsonb)
      on conflict (provider, provider_user_id) do update
      set phone_verified = true,
          last_login_at = now(),
          updated_at = now()
      where public.user_identities.user_id = excluded.user_id
    `;
    await transaction`
      insert into public.legal_consents (
        subject_type, subject_id, consent_type, document_version, granted,
        granted_at, revoked_at, source_path, user_agent_short
      )
      select 'customer', ${userId}::uuid, 'marketing', ${LEGAL_VERSION}, true,
        now(), null, '/login/social/complete', ${params.userAgent}
      where ${params.marketingConsent}
    `;
    await transaction`update public.customers set last_login_at = now(), updated_at = now() where id = ${userId}::uuid`;
    return { userId, redirectTo: pending.redirect_to ?? "/profile", provider: claims.provider };
  });

  await setCustomerSession(result.userId);
  await writeAuditLog({
    action: "customer.social_identity_completed",
    actorId: result.userId,
    actorRefHash: hashPrivacyValue(params.phone),
    actorType: "customer",
    entityId: result.userId,
    entityType: "customer",
    metadata: { provider: result.provider },
    sourcePath: "/login/social/complete"
  });
  return result;
}

export { claimsSchema };
