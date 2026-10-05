import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const upgradeArgument = process.argv[3];
if (process.argv[2] !== "--local-only" || process.argv.length > 4
  || (upgradeArgument && !/^--upgrade-from=[a-f0-9]{40}$/.test(upgradeArgument))) {
  throw new Error("Use --local-only; external targets and application environment are not accepted.");
}
const upgradeFrom = upgradeArgument?.slice("--upgrade-from=".length) ?? "origin/main";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "outputs/release-20261003/database");
mkdirSync(output, { recursive: true });
const container = "karimoff-delivery-integration-pg-20261004";
const port = 55445;
const label = "karimoff.rc-verification=20261004";
const image = "postgres:17-alpine";
const runId = Date.now().toString();
const names = Object.fromEntries(["fresh", "upgrade", "restore"].map(kind => [kind, `karimoff_rc_${kind}_${runId}`]));
const evidence = { checkedAt: new Date().toISOString(), main: "", upgradeBase: "", container, image, port, databases: names, migrations: {}, checks: {} };

function exec(binary, args, input, binaryOutput = false) {
  const result = spawnSync(binary, args, {
    cwd: root, input, encoding: binaryOutput ? undefined : "utf8", timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${binary} ${args.slice(0, 4).join(" ")} failed: ${result.stderr ?? result.error}`);
  }
  return binaryOutput ? result.stdout : result.stdout.trim();
}
const context = exec("docker", ["context", "show"]);
assert.ok(exec("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"])
  .startsWith("unix://"), "Only a local Docker daemon is allowed");
const docker = (args, input, binaryOutput) => exec("docker", ["--context", context, ...args], input, binaryOutput);
const known = docker(["ps", "-a", "--format", "{{.Names}}"]);
if (!known.split("\n").includes(container)) {
  const network = `${container}-network`;
  if (!docker(["network", "ls", "--format", "{{.Name}}"] ).split("\n").includes(network)) {
    docker(["network", "create", "--internal", "--label", label, network]);
  }
  assert.equal(JSON.parse(docker(["network", "inspect", network]))[0].Labels["karimoff.rc-verification"], "20261004");
  docker(["run", "-d", "--name", container, "--label", label, "--network", network,
    "--log-driver", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=1024m",
    "-p", `127.0.0.1:${port}:5432`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image]);
}
const own = JSON.parse(docker(["inspect", container]))[0];
assert.equal(own.Config.Labels["karimoff.rc-verification"], "20261004");
assert.equal(own.Config.Image, image);
assert.deepEqual(own.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: String(port) }]);
if (!own.State.Running) docker(["start", container]);
// Docker does not publish ports on an internal-only network. No application
// workers or provider credentials are present in this database container.
if (!own.NetworkSettings.Networks.bridge) docker(["network", "connect", "bridge", container]);
for (let attempt = 0; attempt < 60; attempt++) {
  const r = spawnSync("docker", ["--context", context, "exec", container, "pg_isready", "-U", "postgres"], { timeout: 5000 });
  if (r.status === 0) break;
  assert.ok(attempt < 59, "Local PostgreSQL did not start");
  await new Promise(done => setTimeout(done, 500));
}
function query(database, role, source) {
  return docker(["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", database], source);
}
query("postgres", "postgres", `
  do $$ begin
    if not exists(select 1 from pg_roles where rolname='karimoff_migrator') then
      create role karimoff_migrator login nosuperuser nocreatedb nocreaterole nobypassrls;
      create role karimoff_app login nosuperuser nocreatedb nocreaterole nobypassrls;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    end if;
  end $$;
`);
for (const name of Object.values(names)) {
  query("postgres", "postgres", `create database ${name} owner karimoff_migrator;
    revoke all on database ${name} from public; grant connect on database ${name} to karimoff_app;`);
  if (name === names.restore) continue;
  query(name, "karimoff_migrator", `
    revoke create on schema public from public;
    grant usage on schema public to karimoff_app;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role,karimoff_app;
    create schema rc_validation;
    create table rc_validation.migrations(name text primary key, sha256 text not null);
    grant usage on schema rc_validation to karimoff_app;
    grant select on rc_validation.migrations to karimoff_app;
  `);
}
const directory = join(root, "database/migrations");
const candidate = readdirSync(directory).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
const mainPaths = new Map(exec("git", ["ls-tree", "-r", "--name-only", upgradeFrom])
  .split("\n").filter(path => /^(?:database|supabase)\/migrations\/\d+_[a-z0-9_]+\.sql$/.test(path))
  .map(path => [path.split("/").at(-1), path]));
const mainFiles = [...mainPaths.keys()].sort();
assert.ok(mainFiles.length > 0, "Main migration history must be present");
evidence.main = exec("git", ["rev-parse", "origin/main"]);
evidence.upgradeBase = exec("git", ["rev-parse", `${upgradeFrom}^{commit}`]);
function apply(database, migration, source) {
  const hash = createHash("sha256").update(source).digest("hex");
  const previous = query(database, "karimoff_migrator", `select sha256 from rc_validation.migrations where name='${migration}'`);
  if (previous) { assert.equal(previous, hash, `Previously applied migration changed: ${migration}`); return; }
  const ownsTransaction = /^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source);
  query(database, "karimoff_migrator", ownsTransaction ? source : `begin;\n${source}\ncommit;`);
  query(database, "karimoff_migrator", `insert into rc_validation.migrations values('${migration}','${hash}');`);
  if (query(database, "karimoff_migrator", "select to_regclass('public.audit_logs') is not null;") === 't') {
    query(database, "karimoff_migrator", `insert into public.audit_logs(actor_type,action,entity_type,metadata)
      values('system','schema_migration.${migration.replace(/\.sql$/, '')}','migration','{}');`);
  }
  if (migration === "202607070001_karimoff_baseline_schema.sql") {
    query(database, "karimoff_migrator", readFileSync(join(root, "database/seeds/seed-products-from-juikaifui.sql"), "utf8"));
  }
}
for (const file of candidate) apply(names.fresh, file, readFileSync(join(directory, file), "utf8"));
for (const file of mainFiles) apply(names.upgrade, file, exec("git", ["show", `${upgradeFrom}:${mainPaths.get(file)}`], undefined, true).toString("utf8"));
const upgradeStart = query(names.upgrade, "karimoff_migrator", "select count(*) from public.products;");
const upgradeRunner = spawnSync(process.execPath, ["scripts/apply-runtime-schema-migrations.mjs"], {
  cwd: root, encoding: "utf8", timeout: 60_000,
  env: { PATH: process.env.PATH, NODE_ENV: "production",
    MIGRATION_DATABASE_URL: `postgres://karimoff_migrator@127.0.0.1:${port}/${names.upgrade}`,
    DATABASE_URL: "postgres://never-use-runtime-for-ddl.invalid/runtime" }
});
assert.equal(upgradeRunner.status, 0, upgradeRunner.stderr);
writeFileSync(join(output, "upgrade-runner.log"), upgradeRunner.stdout);
for (const file of candidate) {
  const source = readFileSync(join(directory, file), "utf8");
  if (!mainFiles.includes(file)) {
    assert.equal(query(names.upgrade, "karimoff_migrator", `select exists(select 1 from audit_logs
      where action='schema_migration.${file.replace(/\.sql$/, '')}');`), 't');
    query(names.upgrade, "karimoff_migrator", `insert into rc_validation.migrations values('${file}',
      '${createHash('sha256').update(source).digest('hex')}');`);
  } else apply(names.upgrade, file, source);
}
assert.equal(query(names.upgrade, "karimoff_app", "select count(*) from public.products;"), upgradeStart);
evidence.migrations = { fresh: candidate.length, base: mainFiles.length, added: candidate.filter(file => !mainFiles.includes(file)),
  unchangedHistory: true, upgradeViaActualRunner: true, runtimeUrlIgnoredForDdl: true };

for (const kind of ["fresh", "upgrade"]) {
  const database = names[kind];
  const url = `postgres://karimoff_app@127.0.0.1:${port}/${database}`;
  const sql = postgres(url, { max: 1, onnotice() {} });
  try {
    const [permissions] = await sql`select current_user as role, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
      has_schema_privilege(current_user,'public','create') as schema_create,
      has_database_privilege(current_user,current_database(),'create') as database_create
      from pg_roles where rolname=current_user`;
    for (const flag of ["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls", "schema_create", "database_create"]) assert.equal(permissions[flag], false, flag);
    const [owner] = await sql`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relowner=current_user::regrole`;
    assert.equal(owner.count, 0);
    const [product] = await sql`select id from public.products where is_active order by id limit 1`;
    assert.ok(product);
    await sql`insert into public.customers(name,phone) values ('RC synthetic customer', ${kind === 'fresh' ? '+70000000001' : '+70000000002'})`;
    const [location] = await sql`select id from public.order_locations where is_default limit 1`;
    const [order] = await sql`select * from public.create_pos_order_atomic(${location.id}::uuid,
      'RC synthetic pickup', null, ${sql.json([{product_id: product.id, quantity: 1}])}::jsonb,
      ${crypto.randomUUID()}::uuid, null::uuid, 'owner', 'asap', null::timestamptz, true)`;
    assert.ok(order.order_id);
    const [payment] = await sql`insert into payments(order_id,provider,idempotency_key,status,amount,currency)
      select id,'yookassa',${crypto.randomUUID()},'pending',total,'RUB' from orders where id=${order.order_id} returning id`;
    await sql`insert into fiscal_receipts(order_id,payment_id,provider,receipt_type,status,idempotency_key,amount)
      select id,${payment.id},'yookassa','sale','pending',${crypto.randomUUID()},total from orders where id=${order.order_id}`;
    const [ingredient] = await sql`insert into ingredients(name,unit,cost_per_unit) values('Synthetic restore ingredient','g',1) returning id`;
    await sql`insert into inventory_items(ingredient_id,unit,current_quantity) values(${ingredient.id},'g',100)`;
    await sql`insert into public.audit_logs(actor_type,action,entity_type,metadata)
      values ('system','rc.runtime_check','release','{}')`;
    for (const statement of ["create table public.runtime_should_fail(id int)",
      "alter table public.products add column runtime_should_fail int", "drop table public.products",
      "create schema runtime_should_fail"]) {
      await assert.rejects(sql.unsafe(statement), error => error.code === '42501');
    }
    const [objects] = await sql`select
      (select count(*)::int from pg_tables where schemaname='public') as tables,
      (select count(*)::int from pg_indexes where schemaname='public') as indexes,
      (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public') as constraints,
      (select count(*)::int from pg_sequences where schemaname='public') as sequences`;
    evidence.checks[kind] = { permissions, owners: owner.count, objects, runtimeOrderCreated: true, createAlterDropDenied: true };
    const verification = spawnSync(process.execPath, ["scripts/apply-runtime-schema-migrations.mjs"], {
      cwd: root, encoding: "utf8", timeout: 60_000,
      env: { PATH: process.env.PATH, NODE_ENV: "production", DATABASE_URL: url, RUNTIME_MIGRATIONS_READ_ONLY: "true" }
    });
    assert.equal(verification.status, 0, verification.stderr);
    evidence.checks[kind].runtimeSchemaVerification = true;
  } finally { await sql.end(); }
}
const fingerprint = (database) => query(database, "karimoff_migrator", `select json_build_object(
  'products',(select count(*) from public.products),'orders',(select count(*) from public.orders),
  'payments',(select count(*) from public.payments),'receipts',(select count(*) from public.fiscal_receipts),
  'users',(select count(*) from public.customers)+(select count(*) from public.staff_users),
  'inventory',(select count(*) from public.inventory_items),'migrations',(select count(*) from rc_validation.migrations));`);
const expected = fingerprint(names.fresh);
const contentHashes = database => Object.fromEntries(['products','orders','payments','fiscal_receipts','customers','inventory_items']
  .map(table => [table, query(database, 'karimoff_migrator', `select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'empty')) from public.${table} t`)]));
const expectedHashes = contentHashes(names.fresh);
const started = performance.now();
const dump = docker(["exec", container, "pg_dump", "-U", "karimoff_migrator", "-Fc", names.fresh], undefined, true);
writeFileSync(join(output, "synthetic.dump"), dump);
docker(["exec", "-i", container, "pg_restore", "-U", "karimoff_migrator", "--no-owner", "--exit-on-error", "-d", names.restore], dump);
assert.equal(fingerprint(names.restore), expected);
assert.deepEqual(contentHashes(names.restore), expectedHashes);
assert.equal(query(names.restore, "karimoff_app", "select count(*) from public.products;"), query(names.fresh, "karimoff_app", "select count(*) from public.products;"));
evidence.restore = { method: "local synthetic pg_dump -Fc / pg_restore", bytes: dump.length,
  milliseconds: Math.round(performance.now() - started), matched: JSON.parse(expected), contentHashes: expectedHashes,
  productionBackupRestored: false };
evidence.runtimeDsn = `postgres://karimoff_app@127.0.0.1:${port}/${names.fresh}`;
writeFileSync(join(output, "ready.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
