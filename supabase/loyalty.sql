create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade unique,
  points_balance numeric default 0,
  total_earned numeric default 0,
  total_spent numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  customer_id uuid references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  type text not null,
  points numeric not null,
  description text
);

alter table public.loyalty_accounts add column if not exists customer_id uuid references public.customers(id) on delete cascade;
alter table public.loyalty_accounts add column if not exists points_balance numeric default 0;
alter table public.loyalty_accounts add column if not exists total_earned numeric default 0;
alter table public.loyalty_accounts add column if not exists total_spent numeric default 0;
alter table public.loyalty_accounts add column if not exists updated_at timestamptz default now();

alter table public.loyalty_transactions add column if not exists created_at timestamptz default now();
alter table public.loyalty_transactions add column if not exists customer_id uuid references public.customers(id) on delete cascade;
alter table public.loyalty_transactions add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.loyalty_transactions add column if not exists type text;
alter table public.loyalty_transactions add column if not exists points numeric not null default 0;
alter table public.loyalty_transactions add column if not exists description text;

create unique index if not exists loyalty_accounts_customer_id_key on public.loyalty_accounts (customer_id);
create index if not exists loyalty_transactions_customer_id_idx on public.loyalty_transactions (customer_id);
create index if not exists loyalty_transactions_order_id_idx on public.loyalty_transactions (order_id);
create index if not exists loyalty_transactions_created_at_idx on public.loyalty_transactions (created_at desc);
create unique index if not exists loyalty_transactions_order_earn_key
on public.loyalty_transactions (order_id, type)
where order_id is not null and type = 'earn';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists loyalty_accounts_set_updated_at on public.loyalty_accounts;
create trigger loyalty_accounts_set_updated_at
before update on public.loyalty_accounts
for each row
execute function public.set_updated_at();
