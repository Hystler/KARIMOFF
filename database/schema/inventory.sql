create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  ingredient_id uuid references public.ingredients(id) on delete cascade unique,
  current_quantity numeric not null default 0,
  reserved_quantity numeric not null default 0,
  min_quantity numeric not null default 0,
  unit text not null default 'g',
  location text,
  is_active boolean default true
);

alter table public.inventory_items add column if not exists updated_at timestamptz default now();
alter table public.inventory_items add column if not exists ingredient_id uuid references public.ingredients(id) on delete cascade;
alter table public.inventory_items add column if not exists current_quantity numeric not null default 0;
alter table public.inventory_items add column if not exists reserved_quantity numeric not null default 0;
alter table public.inventory_items add column if not exists min_quantity numeric not null default 0;
alter table public.inventory_items add column if not exists unit text not null default 'g';
alter table public.inventory_items add column if not exists location text;
alter table public.inventory_items add column if not exists is_active boolean default true;

create unique index if not exists inventory_items_ingredient_id_key on public.inventory_items (ingredient_id);
create index if not exists inventory_items_ingredient_id_idx on public.inventory_items (ingredient_id);
create index if not exists inventory_items_is_active_idx on public.inventory_items (is_active);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  ingredient_id uuid references public.ingredients(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  movement_type text not null,
  quantity numeric not null,
  unit text not null,
  reason text,
  comment text,
  created_by text default 'system'
);

alter table public.inventory_movements add column if not exists ingredient_id uuid references public.ingredients(id) on delete set null;
alter table public.inventory_movements add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.inventory_movements add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.inventory_movements add column if not exists movement_type text not null default 'correction';
alter table public.inventory_movements add column if not exists quantity numeric not null default 0;
alter table public.inventory_movements add column if not exists unit text not null default 'g';
alter table public.inventory_movements add column if not exists reason text;
alter table public.inventory_movements add column if not exists comment text;
alter table public.inventory_movements add column if not exists created_by text default 'system';

create index if not exists inventory_movements_ingredient_id_idx on public.inventory_movements (ingredient_id);
create index if not exists inventory_movements_created_at_idx on public.inventory_movements (created_at);
create index if not exists inventory_movements_movement_type_idx on public.inventory_movements (movement_type);
create index if not exists inventory_movements_order_id_idx on public.inventory_movements (order_id);

create table if not exists public.order_inventory_deductions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  order_id uuid references public.orders(id) on delete cascade unique,
  status text default 'deducted'
);

alter table public.order_inventory_deductions add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.order_inventory_deductions add column if not exists status text default 'deducted';

create unique index if not exists order_inventory_deductions_order_id_key on public.order_inventory_deductions (order_id);
create index if not exists order_inventory_deductions_order_id_idx on public.order_inventory_deductions (order_id);

create or replace function public.set_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row
execute function public.set_inventory_updated_at();
