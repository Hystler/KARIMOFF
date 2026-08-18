-- Unified customer identities and short-lived OAuth state.
-- Provider access/refresh tokens are intentionally not persisted.

alter table public.customers
  add column if not exists phone_verified_at timestamptz;

create table if not exists public.user_identities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.customers(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  username text,
  display_name text,
  avatar_url text,
  email text,
  phone text,
  phone_verified boolean not null default false,
  linked_at timestamptz not null default now(),
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_identities_provider_check
    check (provider in ('phone', 'telegram', 'vk')),
  constraint user_identities_provider_user_id_length_check
    check (char_length(provider_user_id) between 1 and 255),
  constraint user_identities_metadata_check
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  constraint user_identities_profile_lengths_check
    check (
      (username is null or char_length(username) <= 128)
      and (display_name is null or char_length(display_name) <= 160)
      and (avatar_url is null or char_length(avatar_url) <= 2048)
      and (email is null or char_length(email) <= 320)
      and (phone is null or char_length(phone) <= 32)
    ),
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

create index if not exists user_identities_user_idx
  on public.user_identities (user_id, linked_at);
create index if not exists user_identities_phone_verified_idx
  on public.user_identities (phone)
  where phone_verified and phone is not null;

create table if not exists public.oauth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  state_hash text not null unique,
  verifier_ciphertext text not null,
  nonce_ciphertext text,
  intent text not null default 'login',
  linking_user_id uuid references public.customers(id) on delete cascade,
  redirect_to text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_hash text,
  user_agent_short text,
  constraint oauth_login_attempts_provider_check check (provider in ('telegram', 'vk')),
  constraint oauth_login_attempts_intent_check check (intent in ('login', 'link')),
  constraint oauth_login_attempts_link_check check (
    (intent = 'login' and linking_user_id is null)
    or (intent = 'link' and linking_user_id is not null)
  )
);

create index if not exists oauth_login_attempts_expiry_idx
  on public.oauth_login_attempts (expires_at)
  where consumed_at is null;

create table if not exists public.pending_social_identities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticket_hash text not null unique,
  provider text not null,
  provider_user_id text not null,
  claims jsonb not null,
  redirect_to text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint pending_social_identities_provider_check check (provider in ('telegram', 'vk')),
  constraint pending_social_identities_claims_check check (
    jsonb_typeof(claims) = 'object' and octet_length(claims::text) <= 8192
  )
);

create index if not exists pending_social_identities_expiry_idx
  on public.pending_social_identities (expires_at)
  where consumed_at is null;

insert into public.user_identities (
  user_id,
  provider,
  provider_user_id,
  display_name,
  phone,
  phone_verified,
  linked_at,
  last_login_at,
  metadata
)
select
  c.id,
  'phone',
  c.phone,
  c.name,
  c.phone,
  c.phone_verified_at is not null,
  coalesce(c.created_at, now()),
  c.last_login_at,
  '{}'::jsonb
from public.customers c
where c.phone is not null and btrim(c.phone) <> ''
on conflict (provider, provider_user_id) do update
set
  user_id = excluded.user_id,
  display_name = excluded.display_name,
  phone = excluded.phone,
  phone_verified = public.user_identities.phone_verified or excluded.phone_verified,
  last_login_at = greatest(public.user_identities.last_login_at, excluded.last_login_at),
  updated_at = now();

drop trigger if exists user_identities_set_updated_at on public.user_identities;
create trigger user_identities_set_updated_at
before update on public.user_identities
for each row execute function public.set_updated_at();

-- Exponential temporary lockout: base lock doubles after every threshold-sized
-- batch of failures and is capped at 24 hours.
create or replace function public.auth_rate_limit_failure(
  p_bucket text,
  p_key_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_lock_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.auth_rate_limits%rowtype;
  v_now timestamptz := now();
  v_attempts integer;
  v_lock_multiplier integer;
  v_effective_lock_seconds integer;
begin
  insert into public.auth_rate_limits (
    bucket, key_hash, window_started_at, attempts, updated_at
  )
  values (p_bucket, p_key_hash, v_now, 1, v_now)
  on conflict (bucket, key_hash) do update
  set
    attempts = case
      when public.auth_rate_limits.window_started_at < v_now - make_interval(secs => greatest(1, p_window_seconds))
        then 1
      else public.auth_rate_limits.attempts + 1
    end,
    window_started_at = case
      when public.auth_rate_limits.window_started_at < v_now - make_interval(secs => greatest(1, p_window_seconds))
        then v_now
      else public.auth_rate_limits.window_started_at
    end,
    locked_until = case
      when public.auth_rate_limits.locked_until <= v_now then null
      else public.auth_rate_limits.locked_until
    end,
    updated_at = v_now
  returning * into v_row;

  v_attempts := v_row.attempts;

  if v_attempts >= greatest(1, p_max_attempts) then
    v_lock_multiplier := least(16, 1 << least(4, (v_attempts - greatest(1, p_max_attempts)) / greatest(1, p_max_attempts)));
    v_effective_lock_seconds := least(86400, greatest(1, p_lock_seconds) * v_lock_multiplier);

    update public.auth_rate_limits
    set locked_until = v_now + make_interval(secs => v_effective_lock_seconds),
        updated_at = v_now
    where bucket = p_bucket and key_hash = p_key_hash
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(v_row.locked_until <= v_now, true),
    'attempts', v_attempts,
    'retry_after_seconds', case
      when v_row.locked_until is null or v_row.locked_until <= v_now then 0
      else greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer)
    end
  );
end
$$;

alter table public.user_identities enable row level security;
alter table public.oauth_login_attempts enable row level security;
alter table public.pending_social_identities enable row level security;

revoke all privileges on table public.user_identities from public;
revoke all privileges on table public.oauth_login_attempts from public;
revoke all privileges on table public.pending_social_identities from public;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table
      public.user_identities,
      public.oauth_login_attempts,
      public.pending_social_identities
    to karimoff_app;

    grant select, update on table public.customers to karimoff_app;
    grant execute on function public.auth_rate_limit_failure(text, text, integer, integer, integer) to karimoff_app;

    foreach v_table in array array[
      'user_identities', 'oauth_login_attempts', 'pending_social_identities'
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
