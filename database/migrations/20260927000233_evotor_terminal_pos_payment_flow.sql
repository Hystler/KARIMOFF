-- Tracks Evotor card payment while the POS order is already visible in the kitchen.
-- Additive schema migration for the KARIMOFF POS to Evotor payment flow.

create table if not exists public.evotor_terminal_payment_intents (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.evotor_terminal_devices(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  idempotency_key uuid not null unique,
  amount numeric not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'paid', 'failed', 'cancelled', 'unknown')),
  payload jsonb not null,
  result jsonb not null default '{}'::jsonb,
  created_by_staff_id uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  completed_at timestamptz,
  constraint evotor_terminal_payment_amount_check check (amount > 0),
  constraint evotor_terminal_payment_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint evotor_terminal_payment_result_object check (jsonb_typeof(result) = 'object')
);

comment on table public.evotor_terminal_payment_intents is
  'KARIMOFF POS payment requests sent to a paired Evotor terminal. Unknown results stay locked until verified.';

create index if not exists evotor_terminal_payment_queue_idx
  on public.evotor_terminal_payment_intents (device_id, created_at)
  where status = 'queued';
create index if not exists evotor_terminal_payment_order_idx
  on public.evotor_terminal_payment_intents (order_id, created_at desc);
create unique index if not exists evotor_terminal_payment_one_active_per_device_idx
  on public.evotor_terminal_payment_intents (device_id)
  where status in ('queued', 'processing', 'unknown');

alter table public.evotor_terminal_payment_intents enable row level security;
revoke all on table public.evotor_terminal_payment_intents from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete
      on table public.evotor_terminal_payment_intents to karimoff_app;
    create policy evotor_terminal_payment_intents_app_all
      on public.evotor_terminal_payment_intents
      for all to karimoff_app using (true) with check (true);
  end if;
end
$$;
