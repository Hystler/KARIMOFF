-- Server authentication/point scope remains enforced by application services.
-- The runtime connection receives DML only; ownership stays with the migrator.
do $$
declare
  v_table text;
  v_function regprocedure;
  v_sequence text;
  v_tables text[] := array[
    'analytics_sale_reconciliations', 'app_sessions', 'audit_logs', 'auth_rate_limits',
    'avatar_assets', 'cash_register_events', 'cash_registers', 'cookie_consents',
    'customer_avatars', 'customers', 'delivery_location_settings', 'economics_settings', 'fiscal_receipts', 'ingredients',
    'inventory_items', 'inventory_movements', 'kitchen_sla_settings', 'leads',
    'legal_consents', 'loyalty_accounts', 'loyalty_cards', 'loyalty_transactions',
    'max_login_challenges', 'oauth_login_attempts', 'pending_social_identities',
    'order_inventory_deductions', 'order_item_ingredient_usage', 'order_item_kitchen_state', 'order_item_modifiers',
    'order_items', 'order_locations', 'order_notification_deliveries',
    'order_number_counters', 'order_outbox', 'order_status_events', 'orders',
    'payment_events', 'payments', 'product_images', 'product_ingredients',
    'product_modifier_groups', 'product_modifier_options', 'products',
    'production_overheads', 'production_recipe_expenses', 'production_recipe_items',
    'production_recipes', 'production_run_items', 'production_runs', 'refund_items',
    'refunds', 'site_settings', 'staff_location_access', 'staff_users',
    'user_identities', 'vacancies', 'verification_codes', 'evotor_connections',
    'evotor_devices', 'evotor_documents', 'evotor_employees', 'evotor_inbound_events',
    'evotor_product_mappings', 'evotor_products', 'evotor_receipt_items',
    'evotor_receipts', 'evotor_stores', 'evotor_sync_cursors', 'evotor_sync_errors',
    'evotor_sync_events', 'evotor_terminal_devices', 'evotor_terminal_pairing_codes',
    'evotor_terminal_preview_jobs', 'evotor_terminal_payment_intents'
  ];
begin
  if not exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    raise exception 'Provision the restricted karimoff_app runtime role before migration';
  end if;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app'
    and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then
    raise exception 'karimoff_app must not have superuser, createdb, createrole or bypassrls';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relowner = 'karimoff_app'::regrole)
    or exists (select 1 from pg_namespace where nspname = 'public'
      and nspowner = 'karimoff_app'::regrole) then
    raise exception 'Runtime role must not own application schema or relations';
  end if;
  revoke create on schema public from public, karimoff_app;
  grant usage on schema public to karimoff_app;
  if has_schema_privilege('karimoff_app', 'public', 'create') then
    raise exception 'Runtime role inherits CREATE; remove migration/owner membership';
  end if;

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then continue; end if;
    execute format('revoke all on table public.%I from karimoff_app', v_table);
    execute format('grant select, insert, update, delete on table public.%I to karimoff_app', v_table);
    if (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_table)) then
      execute format('drop policy if exists runtime_application_dml on public.%I', v_table);
      execute format('create policy runtime_application_dml on public.%I for all to karimoff_app using (true) with check (true)', v_table);
    end if;
  end loop;
  for v_sequence in
    select distinct format('%I.%I', ns.nspname, s.relname)
    from pg_class s join pg_namespace ns on ns.oid = s.relnamespace
    join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
    join pg_class t on t.oid = d.refobjid
    where ns.nspname = 'public' and s.relkind = 'S' and t.relname = any(v_tables)
  loop
    execute 'revoke all on sequence ' || v_sequence || ' from karimoff_app';
    execute 'grant usage, select on sequence ' || v_sequence || ' to karimoff_app';
  end loop;
  for v_table in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v','m')
      and c.relname in ('analytics_sales','analytics_sale_items','analytics_sale_payments',
        'canonical_analytics_sales','canonical_analytics_sale_items','canonical_analytics_sale_payments')
  loop
    execute format('grant select on table public.%I to karimoff_app', v_table);
  end loop;
  for v_function in select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('auth_rate_limit_check', 'auth_rate_limit_failure',
        'auth_rate_limit_clear', 'apply_inventory_movement_atomic', 'set_order_status_atomic')
  loop
    execute format('grant execute on function %s to karimoff_app', v_function);
  end loop;
end;
$$;

-- A read-only marker for startup schema verification; runtime cannot write it.
create table if not exists public.runtime_role_grants_version (
  version text primary key check (version = '20261003070000')
);
insert into public.runtime_role_grants_version values ('20261003070000') on conflict do nothing;
revoke all on table public.runtime_role_grants_version from public, karimoff_app;
grant select on table public.runtime_role_grants_version to karimoff_app;
