import { randomUUID } from "node:crypto";
import postgres from "postgres";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--") || args.has(key)) throw new Error("Invalid or duplicate argument.");
  args.set(key, process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : true);
}

const customerId = String(args.get("--customer-id") ?? "");
const requestId = String(args.get("--request-id") ?? randomUUID());
const execute = args.has("--execute");
const confirmation = args.get("--confirm-customer-id");
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerId)) {
  throw new Error("--customer-id must be a customer UUID.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
  throw new Error("--request-id must be a UUID.");
}
if (execute && confirmation !== customerId) {
  throw new Error("Execution requires --confirm-customer-id with the exact customer UUID.");
}
if (!execute && (args.has("--confirm-customer-id") || args.has("--request-id"))) {
  throw new Error("Confirmation and request id are execution-only options.");
}
const databaseUrl = process.env.PERSONAL_DATA_DELETE_DATABASE_URL;
if (!databaseUrl) throw new Error("Set PERSONAL_DATA_DELETE_DATABASE_URL to the explicitly selected operator database.");

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice() {} });

async function getCounts(client) {
  const [counts] = await client`
    select
      (select count(*)::int from public.app_sessions
        where subject_type = 'customer' and subject_id = ${customerId}::uuid and revoked_at is null) as active_sessions,
      (select count(*)::int from public.customer_avatars where customer_id = ${customerId}::uuid) as avatars,
      (select count(*)::int from public.user_identities
        where user_id = ${customerId}::uuid and provider in ('telegram', 'max')
          and (username is not null or display_name is not null or avatar_url is not null
            or email is not null or phone is not null or metadata <> '{}'::jsonb)) as social_extras,
      (select count(*)::int from public.verification_codes
        where phone = (select phone from public.customers where id = ${customerId}::uuid)) as verification_codes,
      (select count(*)::int from public.oauth_login_attempts
        where linking_user_id = ${customerId}::uuid and consumed_at is null) as pending_link_attempts,
      (select count(*)::int from public.pending_social_identities p
        where exists (select 1 from public.user_identities i
          where i.user_id = ${customerId}::uuid and i.provider = p.provider
            and i.provider_user_id = p.provider_user_id)) as pending_social_identities,
      (select count(*)::int from public.customers where id = ${customerId}::uuid and birthday is not null) as birthday_fields,
      (select count(*)::int from public.legal_consents c
        where c.subject_type = 'customer' and c.subject_id = ${customerId}::uuid
          and c.consent_type = 'marketing' and c.granted
          and not exists (select 1 from public.legal_consents newer
            where newer.subject_type = c.subject_type and newer.subject_id = c.subject_id
              and newer.consent_type = c.consent_type and newer.created_at > c.created_at)) as marketing_grants`;
  return counts;
}

try {
  const [database] = await sql`select current_database() as name, current_setting('server_version_num')::int as version`;
  if (!database || database.version < 140000) throw new Error("The selected database is unavailable or unsupported.");

  if (!execute) {
    const [customer] = await sql`select exists(select 1 from public.customers where id = ${customerId}::uuid) as exists`;
    if (!customer?.exists) throw new Error("Customer was not found.");
    console.log(JSON.stringify({ mode: "dry-run", customerId, counts: await getCounts(sql), preserves: ["orders", "payments", "fiscal_receipts", "refunds", "accounting records"] }, null, 2));
  } else {
    const result = await sql.begin(async (tx) => {
      const [customer] = await tx`select id, phone from public.customers where id = ${customerId}::uuid for update`;
      if (!customer) throw new Error("Customer was not found.");
      const [prior] = await tx`select id from public.audit_logs
        where action = 'customer.personal_data_request.completed'
          and metadata->>'request_id' = ${requestId}
        limit 1`;
      if (prior) return { alreadyCompleted: true, counts: await getCounts(tx) };

      const before = await getCounts(tx);
      const now = new Date().toISOString();
      const [sessions] = await tx`update public.app_sessions set revoked_at = ${now}
        where subject_type = 'customer' and subject_id = ${customerId}::uuid and revoked_at is null returning id`;
      const [identities] = await tx`select provider, provider_user_id from public.user_identities
        where user_id = ${customerId}::uuid and provider in ('telegram', 'max')`;
      await tx`delete from public.pending_social_identities p using public.user_identities i
        where i.user_id = ${customerId}::uuid and i.provider in ('telegram', 'max')
          and p.provider = i.provider and p.provider_user_id = i.provider_user_id`;
      await tx`delete from public.oauth_login_attempts where linking_user_id = ${customerId}::uuid`;
      await tx`delete from public.verification_codes where phone = ${customer.phone}`;
      await tx`delete from public.customer_avatars where customer_id = ${customerId}::uuid`;
      await tx`update public.customers set birthday = null, updated_at = ${now} where id = ${customerId}::uuid`;
      await tx`update public.user_identities set username = null, display_name = null,
        avatar_url = null, email = null, phone = null, metadata = '{}'::jsonb
        where user_id = ${customerId}::uuid and provider in ('telegram', 'max')`;

      const [marketing] = await tx`select granted, document_version from public.legal_consents
        where subject_type = 'customer' and subject_id = ${customerId}::uuid
          and consent_type = 'marketing'
        order by created_at desc limit 1`;
      if (marketing?.granted) {
        await tx`insert into public.legal_consents (
          subject_type, subject_id, consent_type, document_version, granted,
          granted_at, revoked_at, source_path, user_agent_short
        ) values ('customer', ${customerId}::uuid, 'marketing', ${marketing.document_version},
          false, null, ${now}, '/privacy/request', null)`;
      }

      await tx`insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata, source_path)
        values ('operator', 'customer.personal_data_request.completed', 'privacy_request', ${requestId},
          ${tx.json({ request_id: requestId, revoked_sessions: sessions.length,
            social_identities_sanitized: identities.length,
            erased_optional_fields: ["social profile claims", "avatar configuration", "birthday", "verification codes", "pending auth state"],
            financial_records_preserved: true })}, '/privacy/request')`;
      return { alreadyCompleted: false, before, after: await getCounts(tx) };
    });
    console.log(JSON.stringify({ mode: "execute", customerId, requestId, ...result }, null, 2));
  }
} finally {
  await sql.end({ timeout: 5 });
}
