create table if not exists public.order_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  identity_id uuid not null references public.user_identities(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  event_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_notification_provider_check check (provider in ('telegram', 'max')),
  constraint order_notification_event_check check (event_type in ('ready', 'cancelled')),
  constraint order_notification_status_check check (
    status in ('pending', 'processing', 'retry', 'sent', 'permanent_failure', 'superseded')
  ),
  constraint order_notification_attempts_check check (attempts >= 0),
  constraint order_notification_delivery_unique unique (order_id, identity_id, event_type)
);

create index if not exists order_notification_due_idx
  on public.order_notification_deliveries (available_at, created_at)
  where status in ('pending', 'retry', 'processing');

create index if not exists order_notification_order_idx
  on public.order_notification_deliveries (order_id, created_at desc);

create or replace function public.enqueue_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.to_status not in ('ready', 'cancelled') then
    return new;
  end if;

  insert into public.order_notification_deliveries (
    order_id,
    customer_id,
    identity_id,
    provider,
    provider_user_id,
    event_type
  )
  select
    order_row.id,
    order_row.customer_id,
    identity_row.id,
    identity_row.provider,
    identity_row.provider_user_id,
    new.to_status
  from public.orders order_row
  join public.user_identities identity_row
    on identity_row.user_id = order_row.customer_id
   and identity_row.provider in ('telegram', 'max')
  where order_row.id = new.order_id
    and order_row.customer_id is not null
    and order_row.is_test = false
  on conflict (order_id, identity_id, event_type) do nothing;

  return new;
end
$$;

drop trigger if exists order_status_notification_enqueue on public.order_status_events;
create trigger order_status_notification_enqueue
after insert on public.order_status_events
for each row execute function public.enqueue_order_status_notification();

alter table public.order_notification_deliveries enable row level security;
revoke all privileges on table public.order_notification_deliveries from public;
revoke all privileges on function public.enqueue_order_status_notification() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.order_notification_deliveries to karimoff_app;
    drop policy if exists order_notification_deliveries_app_all on public.order_notification_deliveries;
    create policy order_notification_deliveries_app_all
      on public.order_notification_deliveries
      for all
      to karimoff_app
      using (true)
      with check (true);
  end if;
end
$$;

comment on table public.order_notification_deliveries is
  'Transactional Telegram/MAX order-status delivery queue. Provider credentials and raw payloads are never stored.';
