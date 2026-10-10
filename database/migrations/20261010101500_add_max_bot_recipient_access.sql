create table if not exists public.max_bot_recipient_access (
  identity_id uuid primary key references public.user_identities(id) on delete cascade,
  can_send boolean not null,
  last_event_type text not null,
  last_event_timestamp_ms bigint not null,
  updated_at timestamptz not null default now(),
  constraint max_bot_recipient_access_event_check check (
    last_event_type in ('bot_started', 'bot_stopped', 'dialog_removed')
  ),
  constraint max_bot_recipient_access_timestamp_check check (last_event_timestamp_ms > 0)
);

alter table public.max_bot_recipient_access enable row level security;
revoke all privileges on table public.max_bot_recipient_access from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update on table public.max_bot_recipient_access to karimoff_app;
    drop policy if exists max_bot_recipient_access_app_all on public.max_bot_recipient_access;
    create policy max_bot_recipient_access_app_all
      on public.max_bot_recipient_access
      for all
      to karimoff_app
      using (true)
      with check (true);
  end if;
end
$$;

comment on table public.max_bot_recipient_access is
  'Minimal MAX bot dialog state for an already-linked identity; no raw webhook payloads, provider IDs, or profile data.';
