import { spawnSync } from "node:child_process";
import { getSupabaseMigrationDbUrl, rootDir } from "./supabase-env.mjs";

const dbUrl = getSupabaseMigrationDbUrl();

if (!dbUrl) {
  console.error("SUPABASE_DB_URL is missing. Add it to .env.local before running the security audit.");
  process.exit(1);
}

const sql = `
select jsonb_build_object(
  'tables_without_rls',
  coalesce((
    select jsonb_agg(c.relname order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ), '[]'::jsonb),
  'unexpected_anon_authenticated_grants',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'role', grantee,
        'table', table_name,
        'privilege', privilege_type
      )
      order by grantee, table_name, privilege_type
    )
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and not (
        table_name in ('products', 'product_images', 'vacancies', 'avatar_assets', 'site_settings')
        and privilege_type = 'SELECT'
      )
  ), '[]'::jsonb),
  'unexpected_function_execute_grants',
  coalesce((
    select jsonb_agg(
      jsonb_build_object('role', grantee, 'function', routine_name)
      order by grantee, routine_name
    )
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and routine_name in (
        'auth_rate_limit_check',
        'auth_rate_limit_failure',
        'auth_rate_limit_clear',
        'create_site_order',
        'apply_inventory_movement_atomic',
        'set_order_status_atomic'
      )
  ), '[]'::jsonb),
  'public_policies',
  coalesce((
    select jsonb_agg(
      jsonb_build_object('table', tablename, 'policy', policyname, 'roles', roles)
      order by tablename, policyname
    )
    from pg_policies
    where schemaname = 'public'
  ), '[]'::jsonb)
) as security_audit;
`;

const result = spawnSync(
  "supabase",
  ["db", "query", "--db-url", dbUrl, "--output-format", "json", sql],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1"
    }
  }
);

process.exit(result.status ?? 1);
