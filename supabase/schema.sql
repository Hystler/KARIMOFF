create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  phone text not null,
  interest text not null check (interest in ('order', 'b2b', 'career', 'franchise', 'other')),
  comment text,
  status text default 'new' check (status in ('new', 'in_progress', 'closed')),
  source text default 'site'
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_interest_idx on public.leads (interest);
create index if not exists leads_status_idx on public.leads (status);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  slug text unique not null,
  category text not null,
  description text,
  price numeric not null,
  image_url text,
  is_active boolean default true,
  sort_order integer default 100,
  weight text,
  tags text[]
);

alter table public.products add column if not exists updated_at timestamptz default now();
alter table public.products add column if not exists weight text;
alter table public.products add column if not exists tags text[];

create index if not exists products_category_idx on public.products (category);
create index if not exists products_is_active_idx on public.products (is_active);
create index if not exists products_sort_order_idx on public.products (sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();
