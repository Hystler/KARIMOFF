import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

if (process.argv[2] !== "--disposable-audit" || process.argv.slice(3).some(value => value !== "--ui-audit")) {
  throw new Error("Use --disposable-audit. No custom target or environment configuration is accepted.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditId = process.argv.includes("--ui-audit") ? "20260911" : "20260908";
const port = auditId === "20260911" ? 55440 : 55439;
const container = `karimoff-audit-${auditId}`;
const volume = `${container}-data`;
const network = `${container}-network`;
const labelKey = "karimoff.local-audit";
const labelValue = auditId;
const image = "postgres:17-alpine";
const database = "karimoff_audit";
const dsn = `postgres://postgres@127.0.0.1:${port}/karimoff_audit`;
const output = join(root, `outputs/site-audit-${auditId}/database`);
mkdirSync(output, { recursive: true });
const logPath = join(output, `setup-${new Date().toISOString().replaceAll(":", "-")}.log`);

function log(message) {
  appendFileSync(logPath, `${message}\n`);
  console.log(message);
}

function command(args, input) {
  const result = spawnSync("docker", args, {
    input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000
  });
  if (result.error || result.status !== 0) {
    appendFileSync(logPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);
    throw new Error(`Local Docker command failed: ${args.slice(0, 4).join(" ")}. See ${logPath}`, {
      cause: result.error
    });
  }
  return result.stdout.trim();
}

const context = command(["context", "show"]);
const endpoint = command(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
assert.ok(endpoint.startsWith("unix://"), "Refusing a non-local Docker daemon");
const docker = (args, input) => command(["--context", context, ...args], input);
log(`Target: ${container}; ${dsn}; context=${context}; existing 54322 container is not accessed.`);

function ensureResource(kind, name) {
  const names = docker([kind, "ls", "--format", "{{.Name}}"]);
  if (names.split("\n").includes(name)) {
    const labels = JSON.parse(docker([kind, "inspect", name, "--format", "{{json .Labels}}"]));
    assert.equal(labels?.[labelKey], labelValue, `Refusing unowned ${kind}: ${name}`);
  } else {
    docker([kind, "create", "--label", `${labelKey}=${labelValue}`, name]);
  }
}

ensureResource("volume", volume);
ensureResource("network", network);
const names = docker(["ps", "-a", "--format", "{{.Names}}"]);
if (!names.split("\n").includes(container)) {
  docker([
    "run", "-d", "--name", container, "--label", `${labelKey}=${labelValue}`,
    "--restart", "unless-stopped", "--network", network,
    "--publish", `127.0.0.1:${port}:5432`,
    "--mount", `type=volume,src=${volume},dst=/var/lib/postgresql/data`,
    "-e", `POSTGRES_DB=${database}`, "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    image
  ]);
}
const own = JSON.parse(docker(["inspect", container]))[0];
assert.equal(own.Config.Labels?.[labelKey], labelValue, "Refusing an unowned container");
assert.equal(own.Config.Image, image);
assert.equal(own.HostConfig.AutoRemove, false);
assert.deepEqual(own.HostConfig.PortBindings, {
  "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }]
});
assert.deepEqual(Object.keys(own.NetworkSettings.Networks), [network]);
assert.ok(own.Mounts.some(mount => mount.Name === volume && mount.Destination === "/var/lib/postgresql/data"));
if (!own.State.Running) docker(["start", container]);

let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  const result = spawnSync("docker", ["--context", context, "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", database], {
    encoding: "utf8", timeout: 5000
  });
  if (result.status === 0) { ready = true; break; }
  await new Promise(done => setTimeout(done, 500));
}
assert.ok(ready, "PostgreSQL did not become ready");

function query(source) {
  return docker(["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], source);
}

function apply(name, source) {
  log(`Applying ${name}`);
  const result = spawnSync("docker", ["--context", context, "exec", "-i", container,
    "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], {
    input: source, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000
  });
  appendFileSync(logPath, `\n--- ${name} ---\n${result.stdout ?? ""}${result.stderr ?? ""}\n`);
  if (result.error || result.status !== 0) throw new Error(`${name} failed; see ${logPath}`);
}

assert.equal(query("select current_database() || ':' || current_user;"), `${database}:postgres`);
const version = Number(query("select current_setting('server_version_num');"));
assert.ok(version >= 170000 && version < 180000);
if (query("select to_regclass('local_audit.applied_migrations') is not null;") === "f") {
  assert.equal(query("select count(*) from pg_tables where schemaname='public';"), "0", "Refusing an unrecognized populated database");
  apply("local-only roles, auth stubs and migration ledger", `
    begin;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role karimoff_app nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema auth to anon, authenticated, service_role, karimoff_app;
    create schema local_audit;
    create table local_audit.applied_migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now()
    );
    comment on schema local_audit is 'Disposable local audit only; no production data copied';
    commit;
  `);
}

const directory = join(root, "supabase/migrations");
const migrations = readdirSync(directory).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.ok(migrations.length > 0);
for (const name of migrations) {
  const source = readFileSync(join(directory, name), "utf8");
  const digest = createHash("sha256").update(source).digest("hex");
  const previous = query(`select sha256 from local_audit.applied_migrations where name='${name}';`);
  if (previous) {
    assert.equal(previous, digest, `Applied migration changed: ${name}`);
    log(`Already applied ${name}`);
  } else {
    // Two repository migrations own their BEGIN/COMMIT; keep their SQL intact.
    const ownsTransaction = /^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source);
    apply(name, ownsTransaction ? source : `begin;\n${source}\ncommit;`);
    query(`insert into local_audit.applied_migrations(name,sha256) values('${name}','${digest}');`);
  }
  if (name === "202607070001_karimoff_baseline_schema.sql" && query("select count(*) from public.products;") === "0") {
    apply("local menu seed", `begin;\n${readFileSync(join(root, "supabase/seed-products-from-juikaifui.sql"), "utf8")}\ncommit;`);
  }
}

// Connect through the exact loopback DSN used by the PostgreSQL tests, not application config.
const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice() {} });
try {
  const [identity] = await sql`select current_database() as database, current_user as username,
    current_setting('server_version') as version`;
  assert.equal(identity.database, database);
  assert.equal(identity.username, "postgres");
  const [counts] = await sql`select
    (select count(*)::int from local_audit.applied_migrations) as migrations,
    (select count(*)::int from public.order_locations where is_active and is_default) as default_locations,
    (select count(*)::int from public.products) as products,
    (select count(*)::int from public.ingredients) as ingredients,
    (select count(*)::int from public.orders) as orders,
    (select count(*)::int from public.customers) as customers`;
  assert.equal(counts.migrations, migrations.length);
  assert.ok(counts.default_locations > 0 && counts.products > 0);
  const report = {
    status: "schema-ready", checkedAt: new Date().toISOString(), container, image, volume, network,
    dsn, identity, counts, latestMigration: migrations.at(-1), migrations,
    persistent: true, autoRemove: false, hostBind: `127.0.0.1:${port}`,
    auth: "Local-only trust; minimal auth helper stubs, not a Supabase Auth service",
    seed: "Repository menu seed after baseline; order_locations seeded by canonical order migration",
    logPath
  };
  writeFileSync(join(output, "ready.json"), `${JSON.stringify(report, null, 2)}\n`);
  log(JSON.stringify(report));
} finally {
  await sql.end({ timeout: 5 });
}
