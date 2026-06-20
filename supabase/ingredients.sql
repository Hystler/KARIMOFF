create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  category text,
  unit text not null default 'g',
  cost_per_unit numeric not null default 0,
  package_size numeric,
  package_price numeric,
  is_active boolean default true,
  sort_order integer default 100
);

alter table public.ingredients add column if not exists created_at timestamptz default now();
alter table public.ingredients add column if not exists updated_at timestamptz default now();
alter table public.ingredients add column if not exists name text;
alter table public.ingredients add column if not exists category text;
alter table public.ingredients add column if not exists unit text not null default 'g';
alter table public.ingredients add column if not exists cost_per_unit numeric not null default 0;
alter table public.ingredients add column if not exists package_size numeric;
alter table public.ingredients add column if not exists package_price numeric;
alter table public.ingredients add column if not exists is_active boolean default true;
alter table public.ingredients add column if not exists sort_order integer default 100;

create index if not exists ingredients_category_idx on public.ingredients (category);
create index if not exists ingredients_is_active_idx on public.ingredients (is_active);
create index if not exists ingredients_sort_order_idx on public.ingredients (sort_order);

create table if not exists public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  quantity numeric not null default 0,
  unit text not null default 'g',
  sort_order integer default 100
);

alter table public.product_ingredients add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.product_ingredients add column if not exists ingredient_id uuid references public.ingredients(id) on delete restrict;
alter table public.product_ingredients add column if not exists quantity numeric not null default 0;
alter table public.product_ingredients add column if not exists unit text not null default 'g';
alter table public.product_ingredients add column if not exists sort_order integer default 100;

create index if not exists product_ingredients_product_id_idx on public.product_ingredients (product_id);
create index if not exists product_ingredients_ingredient_id_idx on public.product_ingredients (ingredient_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ingredients_set_updated_at on public.ingredients;
create trigger ingredients_set_updated_at
before update on public.ingredients
for each row
execute function public.set_updated_at();
