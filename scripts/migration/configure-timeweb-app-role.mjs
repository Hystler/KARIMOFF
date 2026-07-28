import { readFileSync } from "node:fs";
import postgres from "postgres";

const appRole = "karimoff_app";
const identifierPattern = /^[a-z_][a-z0-9_]*$/;

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[trimmed.slice(0, separator).trim()] = value;
  }
  return result;
}

function quoteIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error(`Unsupported identifier: ${value}`);
  return `"${value}"`;
}

const envPath =
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env";
const env = readEnv(envPath);
const databaseUrl = process.env.TARGET_DATABASE_URL || env.TARGET_DATABASE_URL;

if (!databaseUrl) {
  console.error(`TARGET_DATABASE_URL is missing in ${envPath}.`);
  process.exit(2);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 5,
  max: 1,
  prepare: false
});

try {
  const roles = await sql`
    select 1
    from pg_roles
    where rolname = ${appRole}
  `;
  if (!roles.length) throw new Error(`Timeweb role ${appRole} does not exist.`);

  const tables = await sql`
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `;

  await sql.begin(async (transaction) => {
    await transaction.unsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(appRole)}`);
    await transaction.unsafe(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${quoteIdentifier(appRole)}`
    );
    await transaction.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(appRole)}`
    );
    await transaction.unsafe(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`);
    await transaction.unsafe(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${quoteIdentifier(appRole)}`
    );
    await transaction.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdentifier(appRole)}`
    );
    await transaction.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${quoteIdentifier(appRole)}`
    );

    for (const { tablename } of tables) {
      const table = quoteIdentifier(tablename);
      const policy = quoteIdentifier(`${tablename}_app_access`);
      await transaction.unsafe(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await transaction.unsafe(`DROP POLICY IF EXISTS ${policy} ON public.${table}`);
      await transaction.unsafe(
        `CREATE POLICY ${policy} ON public.${table} FOR ALL TO ${quoteIdentifier(appRole)} USING (true) WITH CHECK (true)`
      );
    }
  });

  console.log(`Configured ${tables.length} public tables for the server-only Timeweb app role.`);
} finally {
  await sql.end({ timeout: 2 });
}
