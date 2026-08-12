create table if not exists public.evotor_connections (
  id uuid primary key default gen_random_uuid(),
  organization_key text not null default 'karimoff',
  evotor_user_id text not null unique,
  encrypted_token text not null,
  token_fingerprint text not null unique,
  status text not null default 'connected'
    check (status in ('connected', 'error', 'revoked', 'uninstalled')),
  installed_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evotor_stores (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  evotor_store_id text not null,
  name text not null,
  address text,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, evotor_store_id)
);

create table if not exists public.evotor_devices (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  store_id uuid references public.evotor_stores(id) on delete set null,
  evotor_device_id text not null,
  name text,
  status text,
  timezone_offset integer,
  firmware_version text,
  device_model text,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, evotor_device_id)
);

create table if not exists public.evotor_employees (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  evotor_employee_id text not null,
  display_name text not null,
  role_name text,
  evotor_store_ids jsonb not null default '[]'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, evotor_employee_id)
);

create table if not exists public.evotor_products (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  store_id uuid not null references public.evotor_stores(id) on delete cascade,
  evotor_product_id text not null,
  name text not null,
  code text,
  article_number text,
  barcodes jsonb not null default '[]'::jsonb,
  price numeric not null default 0,
  cost_price numeric,
  measure_name text,
  tax text,
  allow_to_sell boolean,
  is_removed boolean not null default false,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, evotor_product_id)
);

create table if not exists public.evotor_product_mappings (
  id uuid primary key default gen_random_uuid(),
  evotor_product_id uuid not null unique references public.evotor_products(id) on delete cascade,
  karimoff_product_id uuid references public.products(id) on delete set null,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  match_method text not null
    check (match_method in ('exact_name', 'sku', 'barcode', 'manual')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evotor_documents (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  store_id uuid not null references public.evotor_stores(id) on delete cascade,
  device_id uuid references public.evotor_devices(id) on delete set null,
  evotor_document_id text not null,
  document_type text not null,
  document_number text,
  close_date timestamptz,
  evotor_employee_id text,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, evotor_document_id)
);

create table if not exists public.evotor_receipts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  document_id uuid not null unique references public.evotor_documents(id) on delete cascade,
  store_id uuid not null references public.evotor_stores(id) on delete cascade,
  device_id uuid references public.evotor_devices(id) on delete set null,
  external_receipt_id text not null,
  receipt_type text not null check (receipt_type in ('sale', 'return', 'correction')),
  receipt_number text,
  evotor_employee_id text,
  closed_at timestamptz,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  payment_types jsonb not null default '[]'::jsonb,
  fiscal_document_number text,
  fiscal_drive_number text,
  fiscal_sign text,
  raw_metadata jsonb not null default '{}'::jsonb,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_receipt_id)
);

create table if not exists public.evotor_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.evotor_receipts(id) on delete cascade,
  source_key text not null,
  evotor_product_id text,
  name text not null,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  discount numeric not null default 0,
  line_total numeric not null default 0,
  tax text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_id, source_key)
);

create table if not exists public.evotor_sync_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  sync_type text not null check (sync_type in ('initial', 'manual', 'check', 'installation', 'uninstallation')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'success', 'failed')),
  idempotency_key text not null unique,
  requested_by text not null default 'system',
  period_from timestamptz,
  period_to timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.evotor_sync_errors (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  sync_event_id uuid references public.evotor_sync_events(id) on delete cascade,
  scope text not null,
  error_code text,
  http_status integer,
  message text not null,
  retryable boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_rate_limits (
  key_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_integration_rate_limit(
  p_key_hash text,
  p_limit integer default 30,
  p_window_seconds integer default 60,
  p_block_seconds integer default 300
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.integration_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  insert into public.integration_rate_limits (key_hash, attempts, window_started_at, updated_at)
  values (p_key_hash, 0, v_now, v_now)
  on conflict (key_hash) do nothing;

  select * into v_row
  from public.integration_rate_limits
  where key_hash = p_key_hash
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => greatest(1, p_window_seconds)) then
    update public.integration_rate_limits
    set attempts = 1, window_started_at = v_now, blocked_until = null, updated_at = v_now
    where key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.attempts + 1 > greatest(1, p_limit) then
    update public.integration_rate_limits
    set attempts = attempts + 1,
        blocked_until = v_now + make_interval(secs => greatest(1, p_block_seconds)),
        updated_at = v_now
    where key_hash = p_key_hash;
    return query select false, greatest(1, p_block_seconds);
    return;
  end if;

  update public.integration_rate_limits
  set attempts = attempts + 1, updated_at = v_now
  where key_hash = p_key_hash;
  return query select true, 0;
end;
$$;

create index if not exists evotor_stores_connection_idx on public.evotor_stores (connection_id);
create index if not exists evotor_devices_store_idx on public.evotor_devices (store_id);
create index if not exists evotor_employees_connection_idx on public.evotor_employees (connection_id);
create index if not exists evotor_products_store_idx on public.evotor_products (store_id, is_removed);
create index if not exists evotor_documents_store_date_idx on public.evotor_documents (store_id, close_date desc);
create index if not exists evotor_receipts_closed_idx on public.evotor_receipts (closed_at desc);
create index if not exists evotor_receipts_store_idx on public.evotor_receipts (store_id, closed_at desc);
create index if not exists evotor_receipt_items_receipt_idx on public.evotor_receipt_items (receipt_id);
create index if not exists evotor_sync_events_connection_idx on public.evotor_sync_events (connection_id, created_at desc);
create index if not exists evotor_sync_errors_connection_idx on public.evotor_sync_errors (connection_id, created_at desc);

drop trigger if exists evotor_connections_set_updated_at on public.evotor_connections;
create trigger evotor_connections_set_updated_at before update on public.evotor_connections
for each row execute function public.set_updated_at();
drop trigger if exists evotor_stores_set_updated_at on public.evotor_stores;
create trigger evotor_stores_set_updated_at before update on public.evotor_stores
for each row execute function public.set_updated_at();
drop trigger if exists evotor_devices_set_updated_at on public.evotor_devices;
create trigger evotor_devices_set_updated_at before update on public.evotor_devices
for each row execute function public.set_updated_at();
drop trigger if exists evotor_employees_set_updated_at on public.evotor_employees;
create trigger evotor_employees_set_updated_at before update on public.evotor_employees
for each row execute function public.set_updated_at();
drop trigger if exists evotor_products_set_updated_at on public.evotor_products;
create trigger evotor_products_set_updated_at before update on public.evotor_products
for each row execute function public.set_updated_at();
drop trigger if exists evotor_product_mappings_set_updated_at on public.evotor_product_mappings;
create trigger evotor_product_mappings_set_updated_at before update on public.evotor_product_mappings
for each row execute function public.set_updated_at();
drop trigger if exists evotor_documents_set_updated_at on public.evotor_documents;
create trigger evotor_documents_set_updated_at before update on public.evotor_documents
for each row execute function public.set_updated_at();
drop trigger if exists evotor_receipts_set_updated_at on public.evotor_receipts;
create trigger evotor_receipts_set_updated_at before update on public.evotor_receipts
for each row execute function public.set_updated_at();
drop trigger if exists evotor_receipt_items_set_updated_at on public.evotor_receipt_items;
create trigger evotor_receipt_items_set_updated_at before update on public.evotor_receipt_items
for each row execute function public.set_updated_at();

alter table public.evotor_connections enable row level security;
alter table public.evotor_stores enable row level security;
alter table public.evotor_devices enable row level security;
alter table public.evotor_employees enable row level security;
alter table public.evotor_products enable row level security;
alter table public.evotor_product_mappings enable row level security;
alter table public.evotor_documents enable row level security;
alter table public.evotor_receipts enable row level security;
alter table public.evotor_receipt_items enable row level security;
alter table public.evotor_sync_events enable row level security;
alter table public.evotor_sync_errors enable row level security;
alter table public.integration_rate_limits enable row level security;

revoke all privileges on table public.evotor_connections from public;
revoke all privileges on table public.evotor_stores from public;
revoke all privileges on table public.evotor_devices from public;
revoke all privileges on table public.evotor_employees from public;
revoke all privileges on table public.evotor_products from public;
revoke all privileges on table public.evotor_product_mappings from public;
revoke all privileges on table public.evotor_documents from public;
revoke all privileges on table public.evotor_receipts from public;
revoke all privileges on table public.evotor_receipt_items from public;
revoke all privileges on table public.evotor_sync_events from public;
revoke all privileges on table public.evotor_sync_errors from public;
revoke all privileges on table public.integration_rate_limits from public;
revoke all on function public.consume_integration_rate_limit(text, integer, integer, integer) from public;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on table public.evotor_connections, public.evotor_stores, public.evotor_devices,
      public.evotor_employees, public.evotor_products, public.evotor_product_mappings,
      public.evotor_documents, public.evotor_receipts, public.evotor_receipt_items,
      public.evotor_sync_events, public.evotor_sync_errors, public.integration_rate_limits from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on table public.evotor_connections, public.evotor_stores, public.evotor_devices,
      public.evotor_employees, public.evotor_products, public.evotor_product_mappings,
      public.evotor_documents, public.evotor_receipts, public.evotor_receipt_items,
      public.evotor_sync_events, public.evotor_sync_errors, public.integration_rate_limits from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.evotor_connections, public.evotor_stores,
      public.evotor_devices, public.evotor_employees, public.evotor_products,
      public.evotor_product_mappings, public.evotor_documents, public.evotor_receipts,
      public.evotor_receipt_items, public.evotor_sync_events, public.evotor_sync_errors,
      public.integration_rate_limits to karimoff_app;
    grant execute on function public.consume_integration_rate_limit(text, integer, integer, integer) to karimoff_app;
    foreach v_table in array array[
      'evotor_connections', 'evotor_stores', 'evotor_devices', 'evotor_employees',
      'evotor_products', 'evotor_product_mappings', 'evotor_documents',
      'evotor_receipts', 'evotor_receipt_items', 'evotor_sync_events',
      'evotor_sync_errors', 'integration_rate_limits'
    ] loop
      execute format('drop policy if exists %I on public.%I', v_table || '_app_all', v_table);
      execute format(
        'create policy %I on public.%I for all to karimoff_app using (true) with check (true)',
        v_table || '_app_all', v_table
      );
    end loop;
  end if;
end
$$;
