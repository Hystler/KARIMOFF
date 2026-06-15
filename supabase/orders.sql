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
  product_id uuid,
  product_name text not null,
  unit_price numeric not null,
  quantity integer not null,
  line_total numeric not null
);

create index if not exists orders_created_at_idx on public.orders (created_at);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
