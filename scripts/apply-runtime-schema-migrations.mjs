import { readFileSync } from "node:fs";
import postgres from "postgres";

const migrations = [
  {
    name: "20260811223000_same_day_orders_waste_evotor_analytics",
    applied: async (sql) => {
      const [column] = await sql`
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'ingredients'
          and column_name = 'waste_percent'
        limit 1
      `;
      return Boolean(column);
    }
  },
  {
    name: "20260812153000_add_production_accounting",
    applied: async (sql) => {
      const [table] = await sql`
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'production_recipes'
        limit 1
      `;
      return Boolean(table);
    }
  },
  {
    name: "20260812190000_add_evotor_cloud_integration",
    applied: async (sql) => {
      const [table] = await sql`
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'evotor_connections'
        limit 1
      `;
      return Boolean(table);
    }
  }
];
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
  for (const migration of migrations) {
    if (await migration.applied(sql)) {
      console.log(`Runtime schema migration already applied: ${migration.name}.`);
      continue;
    }
    const migrationPath = new URL(`../supabase/migrations/${migration.name}.sql`, import.meta.url);
    const migrationSql = readFileSync(migrationPath, "utf8");
    await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${migration.name}))`;
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
          ${`schema_migration.${migration.name}`},
          'database_schema',
          ${{ migration: migration.name }},
          'scripts/apply-runtime-schema-migrations.mjs'
        )
      `;
    });
    console.log(`Runtime schema migration applied: ${migration.name}.`);
  }
} catch (error) {
  console.error(`Runtime schema migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
