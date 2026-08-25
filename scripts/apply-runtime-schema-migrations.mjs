import { readFileSync } from "node:fs";
import postgres from "postgres";

const migrations = [
  {
    name: "20260811223000_same_day_orders_waste_evotor_analytics",
    applied: async (sql) => {
      const [column] = await sql`
        select 1
        from pg_attribute
        where attrelid = to_regclass('public.ingredients')
          and attname = 'waste_percent'
          and not attisdropped
        limit 1
      `;
      return Boolean(column);
    }
  },
  {
    name: "20260812153000_add_production_accounting",
    applied: async (sql) => {
      const [table] = await sql`
        select to_regclass('public.production_recipes') is not null as exists
      `;
      return Boolean(table?.exists);
    }
  },
  {
    name: "20260812190000_add_evotor_cloud_integration",
    applied: async (sql) => {
      const [table] = await sql`
        select to_regclass('public.evotor_connections') is not null as exists
      `;
      return Boolean(table?.exists);
    }
  },
  {
    name: "20260812213000_add_unified_sales_analytics",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          to_regclass('public.analytics_sale_reconciliations') is not null as reconciliations,
          to_regclass('public.staff_location_access') is not null as staff_scope,
          to_regclass('public.analytics_sales') is not null as sales_view,
          to_regclass('public.analytics_sale_items') is not null as items_view,
          to_regclass('public.analytics_sale_payments') is not null as payments_view
      `;
      return Boolean(
        objects?.reconciliations &&
        objects?.staff_scope &&
        objects?.sales_view &&
        objects?.items_view &&
        objects?.payments_view
      );
    }
  },
  {
    name: "20260814120000_add_canonical_order_flow_kds",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          to_regclass('public.order_locations') is not null as locations,
          to_regclass('public.order_status_events') is not null as status_events,
          to_regclass('public.order_outbox') is not null as outbox,
          to_regclass('public.evotor_sync_cursors') is not null as sync_cursors,
          to_regclass('public.canonical_analytics_sales') is not null as canonical_sales,
          to_regprocedure('public.create_pos_order_atomic(uuid,text,text,jsonb,uuid,uuid,text,text,timestamp with time zone)') is not null as create_pos,
          to_regprocedure('public.set_order_kitchen_status_atomic(uuid,text,uuid,text,text)') is not null as transition_order
      `;
      return Boolean(
        objects?.locations &&
        objects?.status_events &&
        objects?.outbox &&
        objects?.sync_cursors &&
        objects?.canonical_sales &&
        objects?.create_pos &&
        objects?.transition_order
      );
    }
  },
  {
    name: "20260815103000_refine_pos_kds_display_operations",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          to_regclass('public.product_modifier_groups') is not null as modifier_groups,
          to_regclass('public.product_modifier_options') is not null as modifier_options,
          exists (
            select 1 from pg_attribute
            where attrelid = to_regclass('public.orders')
              and attname = 'is_operational' and not attisdropped
          ) as operational_orders,
          exists (
            select 1 from pg_attribute
            where attrelid = to_regclass('public.orders')
              and attname = 'is_test' and not attisdropped
          ) as test_orders,
          exists (
            select 1 from pg_attribute
            where attrelid = to_regclass('public.order_items')
              and attname = 'configuration_snapshot' and not attisdropped
          ) as item_snapshot,
          to_regprocedure('public.create_pos_order_atomic(uuid,text,text,jsonb,uuid,uuid,text,text,timestamp with time zone,boolean)') is not null as create_pos_test,
          to_regprocedure('public.create_site_order(uuid,text,text,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamp with time zone,boolean)') is not null as create_web_test
      `;
      return Boolean(
        objects?.modifier_groups &&
        objects?.modifier_options &&
        objects?.operational_orders &&
        objects?.test_orders &&
        objects?.item_snapshot &&
        objects?.create_pos_test &&
        objects?.create_web_test
      );
    }
  },
  {
    name: "20260818170000_add_social_identities_and_auth_hardening",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          to_regclass('public.user_identities') is not null as identities,
          to_regclass('public.oauth_login_attempts') is not null as oauth_attempts,
          to_regclass('public.pending_social_identities') is not null as pending_identities,
          exists (
            select 1 from pg_attribute
            where attrelid = to_regclass('public.customers')
              and attname = 'phone_verified_at' and not attisdropped
          ) as verified_phone
      `;
      return Boolean(
        objects?.identities &&
        objects?.oauth_attempts &&
        objects?.pending_identities &&
        objects?.verified_phone
      );
    }
  },
  {
    name: "20260820190000_add_max_social_auth",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          to_regclass('public.max_login_challenges') is not null as challenges,
          exists (
            select 1
            from pg_constraint
            where conrelid = 'public.user_identities'::regclass
              and conname = 'user_identities_provider_check'
              and pg_get_constraintdef(oid) like '%''max''%'
          ) as max_identity_provider,
          exists (
            select 1
            from pg_constraint
            where conrelid = 'public.pending_social_identities'::regclass
              and conname = 'pending_social_identities_provider_check'
              and pg_get_constraintdef(oid) like '%''max''%'
          ) as max_pending_provider,
          not exists (
            select 1
            from unnest(array[
              'max_login_challenges_pkey',
              'max_login_challenges_challenge_hash_key',
              'max_login_challenges_correlation_id_key',
              'max_login_challenges_provider_check',
              'max_login_challenges_hash_lengths_check',
              'max_login_challenges_intent_check',
              'max_login_challenges_link_check',
              'max_login_challenges_status_check',
              'max_login_challenges_redirect_check',
              'max_login_challenges_identity_size_check',
              'max_login_challenges_error_length_check'
            ]) as expected_constraint(name)
            where not exists (
              select 1
              from pg_constraint
              where conrelid = to_regclass('public.max_login_challenges')
                and conname = expected_constraint.name
                and convalidated
            )
          ) as constraints_valid,
          exists (
            select 1
            from pg_class
            where oid = to_regclass('public.max_login_challenges')
              and relrowsecurity
          ) as rls_enabled,
          to_regclass('public.max_login_challenges_pending_expiry_idx') is not null as expiry_index,
          to_regclass('public.max_login_challenges_linking_user_idx') is not null as linking_index,
          to_regclass('public.max_login_challenges_status_idx') is not null as status_index,
          exists (
            select 1
            from pg_policies
            where schemaname = 'public'
              and tablename = 'max_login_challenges'
              and policyname = 'max_login_challenges_app_all'
              and 'karimoff_app' = any (roles)
          ) as app_policy,
          case
            when to_regclass('public.max_login_challenges') is null then false
            else has_table_privilege(
              'karimoff_app',
              'public.max_login_challenges',
              'select,insert,update,delete'
            )
          end as app_privileges
      `;
      return Boolean(
        objects?.challenges &&
        objects?.max_identity_provider &&
        objects?.max_pending_provider &&
        objects?.constraints_valid &&
        objects?.rls_enabled &&
        objects?.expiry_index &&
        objects?.linking_index &&
        objects?.status_index &&
        objects?.app_policy &&
        objects?.app_privileges
      );
    }
  },
  {
    name: "20260824120000_add_telegram_browser_consume",
    applied: async (sql) => {
      const [objects] = await sql`
        select
          not exists (
            select 1
            from unnest(array[
              'status',
              'identity_ciphertext',
              'provider_verified_at',
              'completed_at',
              'processing_at',
              'browser_consumed_at',
              'completion_result',
              'resolved_user_id',
              'last_error_code'
            ]) as expected_column(name)
            where not exists (
              select 1
              from pg_attribute
              where attrelid = to_regclass('public.oauth_login_attempts')
                and attname = expected_column.name
                and not attisdropped
            )
          ) as lifecycle_columns,
          not exists (
            select 1
            from unnest(array[
              'oauth_login_attempts_status_check',
              'oauth_login_attempts_completion_result_check',
              'oauth_login_attempts_payload_size_check',
              'oauth_login_attempts_error_length_check',
              'oauth_login_attempts_resolved_user_fk'
            ]) as expected_constraint(name)
            where not exists (
              select 1
              from pg_constraint
              where conrelid = to_regclass('public.oauth_login_attempts')
                and conname = expected_constraint.name
                and convalidated
            )
          ) as constraints_valid,
          to_regclass('public.oauth_login_attempts_telegram_status_idx') is not null as status_index,
          exists (
            select 1
            from pg_class
            where oid = to_regclass('public.oauth_login_attempts')
              and relrowsecurity
          ) as rls_enabled,
          case
            when to_regclass('public.oauth_login_attempts') is null then false
            else has_table_privilege(
              'karimoff_app',
              'public.oauth_login_attempts',
              'select,insert,update,delete'
            )
          end as app_privileges
      `;
      return Boolean(
        objects?.lifecycle_columns &&
        objects?.constraints_valid &&
        objects?.status_index &&
        objects?.rls_enabled &&
        objects?.app_privileges
      );
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

let activeMigrationName = null;

try {
  for (const migration of migrations) {
    activeMigrationName = migration.name;
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
    if (!(await migration.applied(sql))) {
      throw new Error(`postcondition check failed for ${migration.name}`);
    }
    console.log(`Runtime schema migration applied: ${migration.name}.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Runtime schema migration failed: ${message}`);
  if (message.startsWith("must be owner of ")) {
    try {
      const [role] = await sql`select current_user as name`;
      const owners = await sql`
        select c.relname, pg_get_userbyid(c.relowner) as owner
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'customers',
            'user_identities',
            'oauth_login_attempts',
            'pending_social_identities'
          )
        order by c.relname
      `;
      const summary = owners.map((row) => `${row.relname}:${row.owner}`).join(",");
      console.error(
        `Runtime schema migration ownership: migration=${activeMigrationName ?? "unknown"} current_role=${role?.name ?? "unknown"} tables=${summary}`
      );
    } catch {
      console.error("Runtime schema migration ownership diagnostic unavailable.");
    }
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
