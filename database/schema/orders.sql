create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  delivery_type text default 'pickup',
  address text,
  comment text,
  status text default 'new',
  total numeric not null default 0,
  source text default 'site'
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric not null,
  quantity integer not null,
  line_total numeric not null
);

alter table public.orders add column if not exists created_at timestamptz default now();
alter table public.orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_phone text;
alter table public.orders add column if not exists delivery_type text default 'pickup';
alter table public.orders add column if not exists address text;
alter table public.orders add column if not exists comment text;
alter table public.orders add column if not exists status text default 'new';
alter table public.orders add column if not exists total numeric not null default 0;
alter table public.orders add column if not exists source text default 'site';

alter table public.order_items add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.order_items add column if not exists product_id uuid;
alter table public.order_items add column if not exists product_name text;
alter table public.order_items add column if not exists unit_price numeric not null default 0;
alter table public.order_items add column if not exists quantity integer not null default 1;
alter table public.order_items add column if not exists line_total numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_product_id_fkey'
  ) then
    alter table public.order_items
    add constraint order_items_product_id_fkey
    foreign key (product_id) references public.products(id) on delete set null;
  end if;
end;
$$;

create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
