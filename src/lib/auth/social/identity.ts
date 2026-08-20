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
  username: z.string().max(128).nullable(),
  displayName: z.string().max(160).nullable(),
  avatarUrl: z.string().url().max(2048).nullable(),
  email: z.string().email().max(320).nullable(),
  phone: z.string().regex(/^\+7\d{10}$/).nullable(),
  phoneVerified: z.boolean(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
});

export type UserIdentityView = {
  id: string;
  provider: "phone" | SocialProvider;
  providerUserId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  givenName: string | null;
  familyName: string | null;
  linkedAt: string;
  lastLoginAt: string | null;
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
        user_id, provider, provider_user_id, username, display_name, avatar_url,
        email, phone, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId}, ${claims.username},
        ${claims.displayName}, ${claims.avatarUrl}, ${claims.email}, ${claims.phone},
        ${claims.phoneVerified}, now(), now(), ${transaction.json(claims.metadata)}
      )
      on conflict (provider, provider_user_id) do update
      set username = excluded.username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          email = excluded.email,
          phone = excluded.phone,
          phone_verified = excluded.phone_verified,
          metadata = excluded.metadata,
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
        user_id, provider, provider_user_id, username, display_name, avatar_url,
        email, phone, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId}, ${claims.username},
        ${claims.displayName}, ${claims.avatarUrl}, ${claims.email}, ${claims.phone},
        ${claims.phoneVerified}, now(), now(), ${transaction.json(claims.metadata)}
      )
      on conflict (provider, provider_user_id) do update
      set username = excluded.username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          email = excluded.email,
          phone = excluded.phone,
          phone_verified = excluded.phone_verified,
          metadata = excluded.metadata,
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
  const { data } = await database
    .from("user_identities")
    .select("id, provider, provider_user_id, username, display_name, avatar_url, email, phone, phone_verified, metadata, linked_at, last_login_at")
    .eq("user_id", userId)
    .in("provider", ["phone", "telegram", "max"])
    .order("linked_at", { ascending: true });

  return (data ?? []).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      id: String(row.id),
      provider: row.provider as UserIdentityView["provider"],
      providerUserId: String(row.provider_user_id),
      username: typeof row.username === "string" ? row.username : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
      avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
      email: typeof row.email === "string" ? row.email : null,
      phone: typeof row.phone === "string" ? row.phone : null,
      phoneVerified: Boolean(row.phone_verified),
      givenName: typeof metadata.givenName === "string" ? metadata.givenName : null,
      familyName: typeof metadata.familyName === "string" ? metadata.familyName : null,
      linkedAt: String(row.linked_at),
      lastLoginAt: typeof row.last_login_at === "string" ? row.last_login_at : null
    };
  });
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
        user_id, provider, provider_user_id, username, display_name, avatar_url,
        email, phone, phone_verified, linked_at, last_login_at, metadata
      )
      values (
        ${userId}::uuid, ${claims.provider}, ${claims.providerUserId}, ${claims.username},
        ${claims.displayName}, ${claims.avatarUrl}, ${claims.email}, ${claims.phone},
        ${claims.phoneVerified}, now(), now(), ${transaction.json(claims.metadata)}
      )
      on conflict (provider, provider_user_id) do update
      set username = excluded.username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          email = excluded.email,
          phone = excluded.phone,
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
      values
        ('customer', ${userId}::uuid, 'personal_data', ${LEGAL_VERSION}, true, now(), null, '/login/social/complete', ${params.userAgent}),
        ('customer', ${userId}::uuid, 'marketing', ${LEGAL_VERSION}, ${params.marketingConsent},
          case when ${params.marketingConsent} then now() else null end,
          case when ${params.marketingConsent} then null else now() end,
          '/login/social/complete', ${params.userAgent})
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
