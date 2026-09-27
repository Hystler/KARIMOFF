create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  slug text unique not null,
  category text not null,
  description text,
  price numeric not null default 0,
  image_url text,
  is_active boolean default true,
  sort_order integer default 100,
  weight text,
  tags text[]
);

alter table public.products add column if not exists created_at timestamptz default now();
alter table public.products add column if not exists updated_at timestamptz default now();
alter table public.products add column if not exists name text;
alter table public.products add column if not exists slug text;
alter table public.products add column if not exists category text;
alter table public.products add column if not exists description text;
alter table public.products add column if not exists price numeric not null default 0;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists is_active boolean default true;
alter table public.products add column if not exists sort_order integer default 100;
alter table public.products add column if not exists weight text;
alter table public.products add column if not exists tags text[];

create unique index if not exists products_slug_key on public.products (slug);
create index if not exists products_category_idx on public.products (category);
create index if not exists products_is_active_idx on public.products (is_active);
create index if not exists products_sort_order_idx on public.products (sort_order);
create index if not exists products_slug_idx on public.products (slug);

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
