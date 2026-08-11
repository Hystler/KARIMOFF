import { readFileSync } from "node:fs";
import postgres from "postgres";

const migrationName = "20260811223000_same_day_orders_waste_evotor_analytics";
const migrationPath = new URL(
  `../supabase/migrations/${migrationName}.sql`,
  import.meta.url
);
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("Runtime schema migrations skipped: database is not configured.");
  process.exit(0);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 5,
  max: 1,
  prepare: false
});

try {
  const [column] = await sql`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ingredients'
      and column_name = 'waste_percent'
    limit 1
  `;

  if (column) {
    console.log(`Runtime schema migration already applied: ${migrationName}.`);
  } else {
    const migrationSql = readFileSync(migrationPath, "utf8");
    await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${migrationName}))`;
      await transaction.unsafe(migrationSql);
      await transaction`
        insert into public.audit_logs (
          actor_type,
          action,
          entity_type,
          metadata,
          source_path
        )
        values (
          'system',
          ${`schema_migration.${migrationName}`},
          'database_schema',
          ${{ migration: migrationName }},
          'scripts/apply-runtime-schema-migrations.mjs'
        )
      `;
    });
    console.log(`Runtime schema migration applied: ${migrationName}.`);
  }
} catch (error) {
  console.error(`Runtime schema migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
