-- MAX authentication uses a bot Mini App and short-lived, browser-bound challenges.
-- Historical VK identities remain valid records, but MAX does not reuse OAuth state.

alter table public.user_identities
  drop constraint if exists user_identities_provider_check;
alter table public.user_identities
  add constraint user_identities_provider_check
  check (provider in ('phone', 'telegram', 'vk', 'max')) not valid;
alter table public.user_identities
  validate constraint user_identities_provider_check;

alter table public.pending_social_identities
  drop constraint if exists pending_social_identities_provider_check;
alter table public.pending_social_identities
  add constraint pending_social_identities_provider_check
  check (provider in ('telegram', 'vk', 'max')) not valid;
alter table public.pending_social_identities
  validate constraint pending_social_identities_provider_check;

create table if not exists public.max_login_challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null default 'max',
  challenge_hash text not null unique,
  browser_binding_hash text not null,
  correlation_id uuid not null unique default gen_random_uuid(),
  intent text not null default 'login',
  linking_user_id uuid references public.customers(id) on delete cascade,
  redirect_to text not null default '/profile',
  status text not null default 'pending',
  identity_ciphertext text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  processing_at timestamptz,
  used_at timestamptz,
  last_error_code text,
  ip_hash text,
  user_agent_short text,
  constraint max_login_challenges_provider_check check (provider = 'max'),
  constraint max_login_challenges_hash_lengths_check check (
    char_length(challenge_hash) = 64
    and char_length(browser_binding_hash) = 64
  ),
  constraint max_login_challenges_intent_check check (intent in ('login', 'link')),
  constraint max_login_challenges_link_check check (
    (intent = 'login' and linking_user_id is null)
    or (intent = 'link' and linking_user_id is not null)
  ),
  constraint max_login_challenges_status_check check (
    status in ('pending', 'awaiting_phone', 'completed', 'failed')
  ),
  constraint max_login_challenges_redirect_check check (
    char_length(redirect_to) between 1 and 500
    and redirect_to like '/%'
    and redirect_to not like '//%'
  ),
  constraint max_login_challenges_identity_size_check check (
    identity_ciphertext is null or octet_length(identity_ciphertext) <= 16384
  ),
  constraint max_login_challenges_error_length_check check (
    last_error_code is null or char_length(last_error_code) <= 80
  )
);

create index if not exists max_login_challenges_pending_expiry_idx
  on public.max_login_challenges (expires_at)
  where used_at is null;
create index if not exists max_login_challenges_linking_user_idx
  on public.max_login_challenges (linking_user_id, created_at desc)
  where linking_user_id is not null and used_at is null;
create index if not exists max_login_challenges_status_idx
  on public.max_login_challenges (status, completed_at desc)
  where used_at is null;

drop trigger if exists max_login_challenges_set_updated_at on public.max_login_challenges;
create trigger max_login_challenges_set_updated_at
before update on public.max_login_challenges
for each row execute function public.set_updated_at();

alter table public.max_login_challenges enable row level security;
revoke all privileges on table public.max_login_challenges from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.max_login_challenges to karimoff_app;
    drop policy if exists max_login_challenges_app_all on public.max_login_challenges;
    create policy max_login_challenges_app_all
      on public.max_login_challenges
      for all
      to karimoff_app
      using (true)
      with check (true);
  end if;
end
$$;
