create table if not exists public.evotor_terminal_devices (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.order_locations(id) on delete restrict,
  device_key text not null unique,
  label text not null default 'Эвотор',
  token_hash text unique,
  app_version text,
  paired_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evotor_terminal_devices_key_length check (char_length(device_key) between 8 and 128),
  constraint evotor_terminal_devices_label_length check (char_length(label) between 1 and 120),
  constraint evotor_terminal_devices_token_length check (token_hash is null or char_length(token_hash) = 64)
);

create table if not exists public.evotor_terminal_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.order_locations(id) on delete cascade,
  code_hash text not null unique,
  created_by_staff_id uuid references public.staff_users(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint evotor_terminal_pairing_codes_hash_length check (char_length(code_hash) = 64),
  constraint evotor_terminal_pairing_codes_expiry check (expires_at > created_at)
);

create table if not exists public.evotor_terminal_preview_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.evotor_terminal_devices(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'delivered', 'acknowledged', 'expired', 'cancelled')),
  created_by_staff_id uuid references public.staff_users(id) on delete set null,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evotor_terminal_preview_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint evotor_terminal_preview_expiry check (expires_at > created_at)
);

create index if not exists evotor_terminal_devices_location_idx
  on public.evotor_terminal_devices (location_id, revoked_at, created_at);
create index if not exists evotor_terminal_pairing_codes_active_idx
  on public.evotor_terminal_pairing_codes (expires_at, created_at)
  where consumed_at is null;
create index if not exists evotor_terminal_preview_jobs_delivery_idx
  on public.evotor_terminal_preview_jobs (device_id, status, created_at)
  where status in ('queued', 'delivered');

alter table public.evotor_terminal_devices enable row level security;
alter table public.evotor_terminal_pairing_codes enable row level security;
alter table public.evotor_terminal_preview_jobs enable row level security;

revoke all on table public.evotor_terminal_devices from public;
revoke all on table public.evotor_terminal_pairing_codes from public;
revoke all on table public.evotor_terminal_preview_jobs from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['service_role', 'karimoff_app'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant select, insert, update, delete on table public.evotor_terminal_devices to %I', v_role);
      execute format('grant select, insert, update, delete on table public.evotor_terminal_pairing_codes to %I', v_role);
      execute format('grant select, insert, update, delete on table public.evotor_terminal_preview_jobs to %I', v_role);
      execute format('create policy evotor_terminal_devices_%I on public.evotor_terminal_devices for all to %I using (true) with check (true)', v_role, v_role);
      execute format('create policy evotor_terminal_pairing_codes_%I on public.evotor_terminal_pairing_codes for all to %I using (true) with check (true)', v_role, v_role);
      execute format('create policy evotor_terminal_preview_jobs_%I on public.evotor_terminal_preview_jobs for all to %I using (true) with check (true)', v_role, v_role);
    end if;
  end loop;
end
$$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.evotor_terminal_devices from %I', v_role);
      execute format('revoke all on table public.evotor_terminal_pairing_codes from %I', v_role);
      execute format('revoke all on table public.evotor_terminal_preview_jobs from %I', v_role);
    end if;
  end loop;
end
$$;
