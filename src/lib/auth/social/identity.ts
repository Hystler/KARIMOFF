import "server-only";

import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCustomerSession, setCustomerSession } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { hashPrivacyValue } from "@/lib/legal-consents";
import { getPostgresSql } from "@/lib/postgres/server";
import { LEGAL_VERSION } from "@/lib/legal";
import { hashOAuthSecret } from "./crypto";
import { resolveSocialLoginTarget } from "./linking-rules";
import type { ConsumedOAuthAttempt } from "./state";
import { createPendingSocialIdentity } from "./state";
import type { SocialIdentityClaims, SocialProvider } from "./types";

const claimsSchema = z.object({
  provider: z.enum(["telegram", "vk"]),
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
  linkedAt: string;
  lastLoginAt: string | null;
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
      throw new Error("Этот способ входа уже связан с другим профилем.");
    }

    const [userProviderIdentity] = await transaction<{ provider_user_id: string }[]>`
      select provider_user_id
      from public.user_identities
      where user_id = ${userId}::uuid
        and provider = ${claims.provider}
      for update
    `;
    if (userProviderIdentity && userProviderIdentity.provider_user_id !== claims.providerUserId) {
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
    await transaction`update public.customers set last_login_at = now(), updated_at = now() where id = ${userId}::uuid`;
  });
}

async function findExistingIdentity(claims: SocialIdentityClaims) {
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");
  const { data } = await database
    .from("user_identities")
    .select("user_id")
    .eq("provider", claims.provider)
    .eq("provider_user_id", claims.providerUserId)
    .maybeSingle();
  return data?.user_id ? String(data.user_id) : null;
}

async function findVerifiedPhoneOwner(phone: string | null) {
  if (!phone) return null;
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");
  const { data } = await database
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .gt("phone_verified_at", "1970-01-01T00:00:00.000Z")
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function completeProviderCallback(
  rawClaims: SocialIdentityClaims,
  attempt: ConsumedOAuthAttempt
) {
  const claims = claimsSchema.parse(rawClaims);
  const existingUserId = await findExistingIdentity(claims);

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
      sourcePath: `/api/auth/social/${claims.provider}/callback`
    });
    return { kind: "linked" as const, redirectTo: attempt.redirectTo };
  }

  const verifiedPhoneUserId = claims.phoneVerified ? await findVerifiedPhoneOwner(claims.phone) : null;
  const target = resolveSocialLoginTarget({
    existingIdentityUserId: existingUserId,
    providerPhoneVerified: claims.phoneVerified,
    verifiedPhoneUserId
  });
  const userId = target.userId;

  if (userId) {
    await bindIdentityToUser(userId, claims);
    await setCustomerSession(userId);
    await writeAuditLog({
      action: "customer.social_login",
      actorId: userId,
      actorRefHash: hashPrivacyValue(`${claims.provider}:${claims.providerUserId}`),
      actorType: "customer",
      entityId: userId,
      entityType: "customer",
      metadata: { provider: claims.provider },
      sourcePath: `/api/auth/social/${claims.provider}/callback`
    });
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
    .select("id, provider, provider_user_id, username, display_name, avatar_url, email, phone, phone_verified, linked_at, last_login_at")
    .eq("user_id", userId)
    .order("linked_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: String(row.id),
    provider: row.provider as UserIdentityView["provider"],
    providerUserId: String(row.provider_user_id),
    username: typeof row.username === "string" ? row.username : null,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    phoneVerified: Boolean(row.phone_verified),
    linkedAt: String(row.linked_at),
    lastLoginAt: typeof row.last_login_at === "string" ? row.last_login_at : null
  }));
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
