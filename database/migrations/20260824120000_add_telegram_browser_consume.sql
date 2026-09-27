-- Telegram Login Library verifies the provider first; the active origin browser
-- consumes the completed attempt separately before a customer session is issued.

alter table public.oauth_login_attempts
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists status text not null default 'pending',
  add column if not exists identity_ciphertext text,
  add column if not exists provider_verified_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists processing_at timestamptz,
  add column if not exists browser_consumed_at timestamptz,
  add column if not exists completion_result text,
  add column if not exists resolved_user_id uuid,
  add column if not exists last_error_code text;

alter table public.oauth_login_attempts
  drop constraint if exists oauth_login_attempts_resolved_user_fk;
alter table public.oauth_login_attempts
  add constraint oauth_login_attempts_resolved_user_fk
  foreign key (resolved_user_id) references public.customers(id) on delete set null not valid;
alter table public.oauth_login_attempts
  validate constraint oauth_login_attempts_resolved_user_fk;

alter table public.oauth_login_attempts
  drop constraint if exists oauth_login_attempts_status_check;
alter table public.oauth_login_attempts
  add constraint oauth_login_attempts_status_check
  check (status in ('pending', 'provider_verified', 'completed', 'failed')) not valid;
alter table public.oauth_login_attempts
  validate constraint oauth_login_attempts_status_check;

alter table public.oauth_login_attempts
  drop constraint if exists oauth_login_attempts_completion_result_check;
alter table public.oauth_login_attempts
  add constraint oauth_login_attempts_completion_result_check
  check (
    completion_result is null
    or completion_result in ('authenticated', 'linked', 'needs_phone')
  ) not valid;
alter table public.oauth_login_attempts
  validate constraint oauth_login_attempts_completion_result_check;

alter table public.oauth_login_attempts
  drop constraint if exists oauth_login_attempts_payload_size_check;
alter table public.oauth_login_attempts
  add constraint oauth_login_attempts_payload_size_check
  check (identity_ciphertext is null or octet_length(identity_ciphertext) <= 16384) not valid;
alter table public.oauth_login_attempts
  validate constraint oauth_login_attempts_payload_size_check;

alter table public.oauth_login_attempts
  drop constraint if exists oauth_login_attempts_error_length_check;
alter table public.oauth_login_attempts
  add constraint oauth_login_attempts_error_length_check
  check (last_error_code is null or char_length(last_error_code) <= 80) not valid;
alter table public.oauth_login_attempts
  validate constraint oauth_login_attempts_error_length_check;

create index if not exists oauth_login_attempts_telegram_status_idx
  on public.oauth_login_attempts (status, completed_at desc)
  where provider = 'telegram' and browser_consumed_at is null;

drop trigger if exists oauth_login_attempts_set_updated_at on public.oauth_login_attempts;
create trigger oauth_login_attempts_set_updated_at
before update on public.oauth_login_attempts
for each row execute function public.set_updated_at();

alter table public.oauth_login_attempts enable row level security;
revoke all privileges on table public.oauth_login_attempts from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.oauth_login_attempts to karimoff_app;
  end if;
end
$$;
