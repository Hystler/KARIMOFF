create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz default now(),
  image_url text not null,
  alt text,
  sort_order integer default 100,
  is_primary boolean default false
);

alter table public.product_images add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.product_images add column if not exists created_at timestamptz default now();
alter table public.product_images add column if not exists image_url text not null;
alter table public.product_images add column if not exists alt text;
alter table public.product_images add column if not exists sort_order integer default 100;
alter table public.product_images add column if not exists is_primary boolean default false;

create index if not exists product_images_product_id_idx on public.product_images(product_id);
create index if not exists product_images_sort_order_idx on public.product_images(sort_order);
create index if not exists product_images_is_primary_idx on public.product_images(is_primary);

