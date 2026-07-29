import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

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
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported identifier: ${value}`);
  }
  return `"${value}"`;
}

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("Usage: database-inventory.mjs <output.json>");
  process.exit(2);
}

const envPath = process.env.MIGRATION_ENV_PATH || ".env.local";
const databaseUrlName = process.env.DATABASE_URL_NAME || "SUPABASE_DB_URL";
const env = readEnv(envPath);
const databaseUrl = process.env[databaseUrlName] || env[databaseUrlName];

if (!databaseUrl) {
  console.error(`${databaseUrlName} is missing in ${envPath}.`);
  process.exit(2);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 5,
  max: 1,
  prepare: false
});

try {
  const [{ server_version: serverVersion }] = await sql`
    select current_setting('server_version') as server_version
  `;
  const tables = await sql`
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `;
  const rowCounts = {};
  const latestCreatedAt = {};

  for (const { tablename } of tables) {
    const table = quoteIdentifier(tablename);
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from public.${table}`
    );
    rowCounts[tablename] = Number(count);

    const [{ has_created_at: hasCreatedAt }] = await sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${tablename}
          and column_name = 'created_at'
      ) as has_created_at
    `;
    if (hasCreatedAt) {
      const [{ latest }] = await sql.unsafe(
        `select max(created_at)::text as latest from public.${table}`
      );
      latestCreatedAt[tablename] = latest ?? null;
    }
  }

  const [objectCounts] = await sql`
    select
      (select count(*)::int from pg_indexes where schemaname = 'public') as indexes,
      (
        select count(*)::int
        from information_schema.table_constraints
        where constraint_schema = 'public' and constraint_type = 'FOREIGN KEY'
      ) as foreign_keys,
      (
        select count(*)::int
        from information_schema.table_constraints
        where constraint_schema = 'public' and constraint_type = 'PRIMARY KEY'
      ) as primary_keys,
      (
        select count(*)::int
        from information_schema.table_constraints
        where constraint_schema = 'public' and constraint_type = 'UNIQUE'
      ) as unique_constraints,
      (
        select count(*)::int
        from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'c'
      ) as check_constraints,
      (
        select count(*)::int
        from pg_proc
        where pronamespace = 'public'::regnamespace
      ) as functions,
      (
        select count(*)::int
        from pg_trigger
        where tgrelid in (
          select oid from pg_class where relnamespace = 'public'::regnamespace
        ) and not tgisinternal
      ) as triggers,
      (
        select count(*)::int
        from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'S'
      ) as sequences,
      (
        select count(*)::int
        from pg_type
        where typnamespace = 'public'::regnamespace and typtype = 'e'
      ) as enums,
      (
        select count(*)::int
        from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
          and relrowsecurity
      ) as rls_tables
  `;

  const report = {
    generated_at: new Date().toISOString(),
    server_version: serverVersion,
    table_count: tables.length,
    object_counts: objectCounts,
    row_counts: rowCounts,
    latest_created_at: latestCreatedAt
  };

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600
  });
  chmodSync(outputPath, 0o600);
  console.log(
    `Inventory written: ${tables.length} tables, ${Object.values(rowCounts).reduce((sum, count) => sum + count, 0)} rows.`
  );
} finally {
  await sql.end({ timeout: 2 });
}
