import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const dsn = process.env.KARIMOFF_COMPLIANCE_TEST_DSN;

test("lead evidence rolls back atomically and deletion preserves order/payment/fiscal data", { skip: !dsn }, async () => {
  assert.match(dsn, /^postgres:\/\/postgres@127\.0\.0\.1:55445\/karimoff_compliance_[a-z0-9_]+$/);
  const sql = postgres(dsn, { max: 1, onnotice() {} });
  const appDsn = new URL(dsn);
  appDsn.username = "karimoff_app";
  const appSql = postgres(appDsn.toString(), { max: 1, onnotice() {} });
  const phone = `+7${String(Date.now()).slice(-10)}`;
  let customerId;
  let orderId;
  let socialCustomerId;
  const requestId = randomUUID();
  let rollbackCustomerId;
  const triggerName = `compliance_fail_${randomUUID().replaceAll("-", "")}`;
  try {
    const appLeadPhone = `+7${String(Date.now() + 3).slice(-10)}`;
    const [appLead] = await appSql`select public.create_lead_with_consents_atomic(
      'Synthetic franchise lead', ${appLeadPhone}, 'franchise', null, 'test', 'franchise',
      'test-v1', '/franchise', null, false)`;
    const appLeadId = appLead.create_lead_with_consents_atomic;
    const [appEvidence] = await sql`select consent_type, document_version, granted from public.legal_consents
      where subject_id = ${appLeadId} and subject_type='lead'`;
    assert.deepEqual(appEvidence, { consent_type: "franchise", document_version: "test-v1", granted: true });
    await sql`delete from public.legal_consents where subject_id = ${appLeadId}`;
    await sql`delete from public.leads where id = ${appLeadId}`;

    const socialPhone = `+7${String(Date.now() + 2).slice(-10)}`;
    const [socialCustomer] = await sql`insert into public.customers(name, phone)
      values ('Synthetic social migration', ${socialPhone}) returning id`;
    socialCustomerId = socialCustomer.id;
    await sql`insert into public.user_identities(user_id, provider, provider_user_id, username,
      display_name, avatar_url, email, phone, phone_verified, metadata)
      values (${socialCustomerId}, 'telegram', ${`migration-${socialCustomerId}`}, 'synthetic_user',
        'Synthetic Name', 'https://example.test/avatar', 'synthetic@example.test', ${socialPhone}, true,
        ${sql.json({ telegramBotUserId: '123456789', loginFlow: 'old', givenName: 'Synthetic' })})`;
    await sql.unsafe(readFileSync("database/migrations/20261008120000_minimize_social_identity_data.sql", "utf8"));
    const [minimized] = await sql`select username, display_name, avatar_url, email, phone, metadata
      from public.user_identities where user_id = ${socialCustomerId} and provider = 'telegram'`;
    assert.deepEqual(minimized, {
      username: null, display_name: null, avatar_url: null, email: null, phone: null,
      metadata: { telegramBotUserId: "123456789" }
    }, "migration must preserve the exact recipient claim still used by Telegram notifications");
    await sql`delete from public.customers where id = ${socialCustomerId}`;
    socialCustomerId = undefined;

    const [rollbackCustomer] = await sql`insert into public.customers(name, phone)
      values ('Synthetic checkout guest', ${`+7${String(Date.now() + 1).slice(-10)}`}) returning id`;
    rollbackCustomerId = rollbackCustomer.id;
    const [product] = await sql`insert into public.products(name, slug, category, price, is_active)
      values ('Synthetic compliance product', ${`compliance-${randomUUID()}`}, 'Тест', 490, true) returning id`;
    const idempotencyKey = randomUUID();
    const [createdOrder] = await sql`select * from public.create_site_order(
      ${rollbackCustomerId}::uuid, 'pickup', null, null,
      ${sql.json([{ product_id: product.id, quantity: 1 }])}::jsonb, ${idempotencyKey}::uuid,
      false, true, false, 'test-offer-v1', '/checkout', 'test-agent', 'asap', null::timestamptz)`;
    assert.ok(createdOrder.order_id, "order creation does not require PD consent");
    const [offer] = await sql`select granted, order_id, document_version, source_path, granted_at from public.legal_consents
      where subject_id = ${rollbackCustomerId} and order_id = ${createdOrder.order_id} and consent_type='offer_acceptance'
      order by created_at desc limit 1`;
    assert.equal(offer.granted, true);
    assert.equal(offer.order_id, createdOrder.order_id);
    assert.equal(offer.document_version, "test-offer-v1");
    assert.equal(offer.source_path, "/checkout");
    assert.ok(offer.granted_at instanceof Date);
    const [syntheticPd] = await sql`select count(*)::int as count from public.legal_consents
      where subject_id = ${rollbackCustomerId} and consent_type='personal_data'`;
    assert.equal(syntheticPd.count, 0);
    await sql`delete from public.legal_consents where order_id = ${createdOrder.order_id}`;
    await sql`delete from public.orders where id = ${createdOrder.order_id}`;
    await sql`delete from public.products where id = ${product.id}`;
    await sql`delete from public.customers where id = ${rollbackCustomerId}`;
    rollbackCustomerId = undefined;

    await sql.unsafe(`create function public.${triggerName}() returns trigger language plpgsql as $$
      begin if new.consent_type = 'careers' then raise exception using errcode='P0001'; end if; return new; end $$;
      create trigger ${triggerName} before insert on public.legal_consents
        for each row execute function public.${triggerName}()`);
    await assert.rejects(sql`select public.create_lead_with_consents_atomic(
      'Synthetic candidate', ${phone}, 'career', null, 'test', 'careers', 'test-v1',
      '/careers', null, false)`);
    const [leadRollback] = await sql`select count(*)::int as count from public.leads where phone = ${phone}`;
    assert.equal(leadRollback.count, 0, "lead insert must roll back when consent evidence fails");
  } finally {
    if (socialCustomerId) await sql`delete from public.customers where id = ${socialCustomerId}`;
    await sql.unsafe(`drop trigger if exists ${triggerName} on public.legal_consents; drop function if exists public.${triggerName}()`);
  }

  try {
    const [customer] = await sql`insert into public.customers(name, phone, birthday)
      values ('Synthetic privacy request', ${phone}, '1990-01-02') returning id`;
    customerId = customer.id;
    const [order] = await sql`insert into public.orders(customer_id, customer_name, customer_phone, total)
      values (${customerId}, 'Synthetic privacy request', ${phone}, 1490) returning id`;
    orderId = order.id;
    await sql`insert into public.payments(order_id, provider, idempotency_key, status, amount)
      values (${orderId}, 'test', ${randomUUID()}, 'paid', 1490)`;
    await sql`insert into public.fiscal_receipts(order_id, idempotency_key, status, amount)
      values (${orderId}, ${randomUUID()}, 'issued', 1490)`;
    await sql`insert into public.user_identities(user_id, provider, provider_user_id, username,
      display_name, avatar_url, email, phone, phone_verified, metadata)
      values (${customerId}, 'telegram', ${`test-${customerId}`}, 'synthetic_user', 'Synthetic Candidate',
        'https://example.test/avatar', 'synthetic@example.test', ${phone}, true, ${sql.json({ extra: "test" })})`;
    await sql`insert into public.customer_avatars(customer_id) values (${customerId})`;
    await sql`insert into public.app_sessions(expires_at, token_hash, subject_type, subject_id)
      values (now() + interval '1 day', ${randomUUID().replaceAll("-", "")}, 'customer', ${customerId})`;
    await sql`insert into public.verification_codes(phone, code_hash, expires_at)
      values (${phone}, 'synthetic-hash', now() + interval '5 minutes')`;
    await sql`insert into public.legal_consents(subject_type, subject_id, consent_type, document_version,
      granted, granted_at, source_path)
      values ('customer', ${customerId}, 'marketing', 'old-v1', true, now(), '/profile')`;

    const env = { PATH: process.env.PATH, PERSONAL_DATA_DELETE_DATABASE_URL: dsn };
    const preview = JSON.parse(execFileSync(process.execPath, ["scripts/delete-customer-personal-data.mjs",
      "--customer-id", customerId], { env, encoding: "utf8" }));
    assert.equal(preview.mode, "dry-run");
    assert.equal(preview.counts.active_sessions, 1);
    const [before] = await sql`select
      (select count(*)::int from public.orders where id = ${orderId}) orders,
      (select count(*)::int from public.payments where order_id = ${orderId}) payments,
      (select count(*)::int from public.fiscal_receipts where order_id = ${orderId}) fiscal`;
    assert.deepEqual(before, { orders: 1, payments: 1, fiscal: 1 });

    const args = ["scripts/delete-customer-personal-data.mjs", "--customer-id", customerId,
      "--request-id", requestId, "--execute", "--confirm-customer-id", customerId];
    const result = JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8" }));
    assert.equal(result.mode, "execute");
    assert.equal(result.alreadyCompleted, false);
    assert.equal(result.before.active_sessions, 1);
    assert.equal(result.after.active_sessions, 0);
    const [after] = await sql`select
      (select count(*)::int from public.orders where id = ${orderId}) orders,
      (select count(*)::int from public.payments where order_id = ${orderId}) payments,
      (select count(*)::int from public.fiscal_receipts where order_id = ${orderId}) fiscal,
      (select count(*)::int from public.customer_avatars where customer_id = ${customerId}) avatars,
      (select count(*)::int from public.app_sessions where subject_id = ${customerId} and revoked_at is not null) revoked_sessions,
      (select count(*)::int from public.user_identities where user_id = ${customerId} and provider='telegram'
        and provider_user_id = ${`test-${customerId}`} and username is null and display_name is null
        and avatar_url is null and email is null and phone is null and metadata = '{}'::jsonb) identity_preserved`;
    assert.deepEqual(after, { orders: 1, payments: 1, fiscal: 1, avatars: 0, revoked_sessions: 1, identity_preserved: 1 });
    const [marketing] = await sql`select granted from public.legal_consents
      where subject_id = ${customerId} and consent_type='marketing' order by created_at desc limit 1`;
    assert.equal(marketing.granted, false);
    const repeated = JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8" }));
    assert.equal(repeated.alreadyCompleted, true);
    const [audit] = await sql`select count(*)::int as count from public.audit_logs
      where entity_type = 'privacy_request' and entity_id = ${requestId}
        and metadata->>'request_id' = ${requestId}`;
    assert.equal(audit.count, 1);
  } finally {
    if (rollbackCustomerId) await sql`delete from public.customers where id = ${rollbackCustomerId}`;
    if (customerId) await sql`delete from public.customers where id = ${customerId}`;
    await appSql.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  }
});
