import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import postgres from "postgres";
import * as zod from "zod";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const migration = "20261005174416_restore_checkout_pgcrypto_dependency.sql";
const migrationSql = readFileSync(`database/migrations/${migration}`, "utf8");
const signature = "public.create_site_order_with_payment_from_whitelist(uuid,text,uuid,jsonb,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamptz,text,text)";

test("PG17 repairs missing pgcrypto and preserves an existing non-public extension, without runtime DDL", async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? "", /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/);
  const admin = postgres("postgres://postgres@127.0.0.1:55445/postgres", { max: 1, onnotice() {} });
  const name = `karimoff_pgcrypto_${randomUUID().replaceAll("-", "")}`;
  let migrator;
  let runtime;
  try {
    const [version] = await admin`select current_setting('server_version_num')::int as version`;
    assert.ok(version.version >= 170000 && version.version < 180000);
    await admin.unsafe(`create database ${name} owner karimoff_migrator`);
    migrator = postgres(`postgres://karimoff_migrator@127.0.0.1:55445/${name}`, { max: 1, onnotice() {} });
    runtime = postgres(`postgres://karimoff_app@127.0.0.1:55445/${name}`, { max: 1, onnotice() {} });
    await migrator.unsafe(`
      revoke all on database ${name} from public;
      grant connect on database ${name} to karimoff_app;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function auth.role() returns text language sql stable as $$ select null::text $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role, karimoff_app;
    `);
    for (const file of readdirSync("database/migrations").filter(file => /^\d+_.*\.sql$/.test(file)).sort()) {
      if (file === migration) break;
      await migrator.unsafe(readFileSync(`database/migrations/${file}`, "utf8"));
    }
    const [role] = await migrator`select current_user, rolsuper from pg_roles where rolname=current_user`;
    assert.equal(role.current_user, "karimoff_migrator");
    assert.equal(role.rolsuper, false, "dependency installation must not require superuser");

    // This is a new, disposable DB owned by this test, never a shared/production DB.
    await migrator`drop extension pgcrypto`;
    await assert.rejects(runtime`select encode(digest('probe'::text, 'sha256'), 'hex')`,
      error => error.code === "42883");

    for (const schema of ["public", "crypto_fixture"]) {
      if (schema !== "public") {
        await migrator`create schema crypto_fixture`;
        await migrator`drop extension pgcrypto`;
        await migrator`create extension pgcrypto with schema crypto_fixture`;
        await migrator.unsafe(readFileSync("database/migrations/20261004133000_whitelist_pickup_rpc_initialization.sql", "utf8"));
      }
      const [original] = await migrator`select pg_get_functiondef(${signature}::regprocedure) as body`;
      const runnerEnv = { PATH: process.env.PATH, NODE_ENV: "production",
        MIGRATION_DATABASE_URL: `postgres://karimoff_migrator@127.0.0.1:55445/${name}` };
      const applied = execFileSync(process.execPath, ["scripts/apply-runtime-schema-migrations.mjs"],
        { env: runnerEnv, encoding: "utf8", timeout: 30_000 });
      assert.match(applied, /Runtime schema migration applied: 20261005174416_restore_checkout_pgcrypto_dependency/);
      const [definition] = await migrator`select pg_get_functiondef(${signature}::regprocedure) as body`;
      assert.ok(definition.body.includes(`encode(${schema}.digest(jsonb_build_object(`));
      assert.equal(definition.body,
        original.body.replace("encode(digest(jsonb_build_object(", `encode(${schema}.digest(jsonb_build_object(`),
        "only qualify digest; preserve all order/payment/idempotency logic");
      await migrator.begin(tx => tx.unsafe(migrationSql));
      const [repeat] = await migrator`select pg_get_functiondef(${signature}::regprocedure) as body`;
      assert.equal(repeat.body, definition.body, "repeat application preserves the function");
      const repeatedRunner = execFileSync(process.execPath, ["scripts/apply-runtime-schema-migrations.mjs"],
        { env: runnerEnv, encoding: "utf8", timeout: 30_000 });
      assert.doesNotMatch(repeatedRunner, /^Runtime schema migration applied:/m);
      const readOnly = execFileSync(process.execPath, ["scripts/apply-runtime-schema-migrations.mjs"], {
        env: { PATH: process.env.PATH, NODE_ENV: "production", RUNTIME_MIGRATIONS_READ_ONLY: "true",
          DATABASE_URL: `postgres://karimoff_app@127.0.0.1:55445/${name}` }, encoding: "utf8", timeout: 30_000
      });
      assert.match(readOnly, /already applied: 20261005174416_restore_checkout_pgcrypto_dependency/);
      const [hash] = await runtime.unsafe(`select encode(${schema}.digest('probe', 'sha256'), 'hex') as hash`);
      assert.equal(hash.hash, createHash("sha256").update("probe").digest("hex"));
      const [extension] = await migrator`select n.nspname from pg_extension e
        join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'`;
      assert.equal(extension.nspname, schema, "do not relocate an existing extension");
      const [rights] = await runtime`select has_schema_privilege(current_user,'public','CREATE') as schema_create,
        has_database_privilege(current_user,current_database(),'CREATE') as database_create`;
      assert.deepEqual(rights, { schema_create: false, database_create: false });
      await assert.rejects(runtime`create table public.runtime_must_not_create(id int)`, error => error.code === "42501");
      await assert.rejects(runtime`alter table public.products add column runtime_must_not_alter int`, error => error.code === "42501");
      await assert.rejects(runtime`drop table public.products`, error => error.code === "42501");

      const rollback = new Error("ROLLBACK_SYNTHETIC_CHECKOUT");
      await runtime.begin(async tx => {
        const [customer] = await tx`insert into customers(name,phone)
          values('Synthetic pgcrypto guest', ${`+7${String(Date.now()).slice(-10)}`}) returning id`;
        const [product] = await tx`insert into products(name,slug,category,price,is_active)
          values('Synthetic sauce',${randomUUID()},'Соусы',40,true) returning id`;
        const key = randomUUID();
        const create = () => tx`select * from create_site_order_with_payment_from_whitelist(
          ${customer.id}::uuid,'pickup',null::uuid,null::jsonb,null,
          ${tx.json([{ product_id: product.id, quantity: 1 }])}::jsonb,${key}::uuid,
          true,true,false,'test','/test','test','asap',null::timestamptz,'mock@example.test',${key})`;
        const [first] = await create();
        const [second] = await create();
        assert.equal(first.order_id, second.order_id);
        assert.equal(first.payment_id, second.payment_id);
        assert.equal(Number(first.total), 40);
        const [counts] = await tx`select
          (select count(*)::int from orders where idempotency_key=${key}::uuid) orders,
          (select count(*)::int from payments where order_id=${first.order_id}::uuid) payments`;
        assert.deepEqual(counts, { orders: 1, payments: 1 });
        throw rollback;
      }).catch(error => { if (error !== rollback) throw error; });
    }
  } finally {
    await runtime?.end();
    await migrator?.end();
    await admin.unsafe(`drop database if exists ${name}`);
    await admin.end();
  }
});

test("checkout failure logs stage/type/SQLSTATE, not error messages, SQL parameters or customer data", async () => {
  const schema = loadTypeScript("src/lib/order-schema.ts", { zod });
  const messages = [];
  let providerCalls = 0;
  let failureStage = "order";
  const imports = Object.fromEntries([
    "@/lib/database/server", "@/lib/order-time", "@/lib/delivery/geo",
    "@/lib/delivery/address-whitelist", "@/lib/delivery/hours", "@/lib/delivery/settings"
  ].map(id => [id, {}]));
  Object.assign(imports, {
    "node:crypto": { randomUUID },
    "@/lib/customer-auth": { getCurrentCustomer: async () => ({ id: randomUUID() }) },
    "@/lib/legal-consents": {
      getShortUserAgent: async () => "synthetic",
      isChecked: value => value === "on",
      getCurrentConsentState: async () => null,
      recordLegalConsents: async () => ({ ok: true })
    },
    "@/lib/legal": { LEGAL_VERSION: "test" },
    "@/lib/order-schema": schema,
    "@/lib/settings": { getSiteSettings: async () => ({ pickup_enabled: true }) },
    "@/lib/payments/yookassa/config": { isYooKassaCheckoutEnabled: () => true },
    "@/lib/payments/yookassa/errors": { safeYooKassaErrorCode: () => "YOOKASSA_UNEXPECTED" },
    "@/lib/observability": { logOperationalError: (event, fields) => messages.push({ event, ...fields }) },
    "@/lib/order-flow/service": { createOrder: async () => {
      if (failureStage === "order") throw Object.assign(new Error("SECRET: SQL params and customer@example.test"), { code: "42883" });
      return { orderId: randomUUID(), paymentId: randomUUID() };
    } },
    "@/lib/payments/yookassa/service": { createYooKassaPaymentForOrder: async () => {
      providerCalls += 1;
      throw new Error("SECRET: authorization and provider payload");
    } }
  });
  const { createOrderAction } = loadTypeScript("src/app/actions/orders.ts", imports);
  const form = new FormData();
  for (const [key, value] of Object.entries({ delivery_type: "pickup", fulfillment_mode: "asap",
    cart: JSON.stringify([{ product_id: randomUUID(), quantity: 1 }]), receipt_email: "customer@example.test",
    personal_data_consent: "on", offer_acceptance: "on", idempotency_key: randomUUID() })) form.set(key, value);
  assert.equal((await createOrderAction(undefined, form)).status, "error");
  assert.equal(providerCalls, 0, "no provider request after DB failure");
  assert.deepEqual(messages[0], { event: "checkout.failed", stage: "create_order", error_type: "Error", sqlstate: "42883" });
  failureStage = "payment";
  assert.equal((await createOrderAction(undefined, form)).status, "error");
  assert.equal(providerCalls, 1);
  assert.deepEqual(messages[1], { event: "checkout.failed", stage: "create_payment", error_type: "Error", sqlstate: undefined });
  assert.doesNotMatch(JSON.stringify(messages), /SECRET|customer@|authorization|params|payload/);
});
