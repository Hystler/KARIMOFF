create table if not exists public.avatar_assets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  type text not null,
  name text not null,
  value text not null,
  image_url text,
  sort_order integer default 100,
  is_active boolean default true
);

alter table public.avatar_assets add column if not exists created_at timestamptz default now();
alter table public.avatar_assets add column if not exists type text not null;
alter table public.avatar_assets add column if not exists name text not null;
alter table public.avatar_assets add column if not exists value text not null;
alter table public.avatar_assets add column if not exists image_url text;
alter table public.avatar_assets add column if not exists sort_order integer default 100;
alter table public.avatar_assets add column if not exists is_active boolean default true;

create unique index if not exists avatar_assets_type_value_key on public.avatar_assets(type, value);
create index if not exists avatar_assets_type_idx on public.avatar_assets(type);
create index if not exists avatar_assets_is_active_idx on public.avatar_assets(is_active);
create index if not exists avatar_assets_sort_order_idx on public.avatar_assets(sort_order);

