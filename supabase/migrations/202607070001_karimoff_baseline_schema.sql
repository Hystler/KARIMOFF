-- KARIMOFF baseline schema migration generated from existing supabase/*.sql files.

-- Apply with: npm run db:push:all


-- ============================================================
-- Source: supabase/schema.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/products.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/customers.sql
-- ============================================================

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  phone text unique not null,
  birthday date,
  password_hash text,
  last_login_at timestamptz
);

alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists updated_at timestamptz default now();
alter table public.customers add column if not exists name text;
alter table public.customers add column if not exists phone text;
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists password_hash text;
alter table public.customers add column if not exists last_login_at timestamptz;

create table if not exists public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create unique index if not exists customers_phone_key on public.customers (phone);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists verification_codes_phone_idx on public.verification_codes (phone);
create index if not exists verification_codes_expires_at_idx on public.verification_codes (expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();


-- ============================================================
-- Source: supabase/orders.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/settings.sql
-- ============================================================

create table if not exists public.site_settings (
  id text primary key default 'main',
  updated_at timestamptz default now(),
  site_name text default 'KARIMOFF',
  phone text,
  address text,
  working_hours text,
  delivery_enabled boolean default true,
  pickup_enabled boolean default true,
  theme text default 'light',
  loyalty_enabled boolean default true,
  loyalty_percent numeric default 5,
  hero_title text,
  hero_subtitle text,
  home_hero_image_url text,
  menu_hero_image_url text,
  business_hero_image_url text,
  careers_hero_image_url text,
  franchise_hero_image_url text,
  about_hero_image_url text,
  telegram_url text,
  instagram_url text,
  tiktok_url text
);

alter table public.site_settings add column if not exists updated_at timestamptz default now();
alter table public.site_settings add column if not exists site_name text default 'KARIMOFF';
alter table public.site_settings add column if not exists phone text;
alter table public.site_settings add column if not exists address text;
alter table public.site_settings add column if not exists working_hours text;
alter table public.site_settings add column if not exists delivery_enabled boolean default true;
alter table public.site_settings add column if not exists pickup_enabled boolean default true;
alter table public.site_settings add column if not exists theme text default 'light';
alter table public.site_settings add column if not exists loyalty_enabled boolean default true;
alter table public.site_settings add column if not exists loyalty_percent numeric default 5;
alter table public.site_settings add column if not exists hero_title text;
alter table public.site_settings add column if not exists hero_subtitle text;
alter table public.site_settings add column if not exists home_hero_image_url text;
alter table public.site_settings add column if not exists menu_hero_image_url text;
alter table public.site_settings add column if not exists business_hero_image_url text;
alter table public.site_settings add column if not exists careers_hero_image_url text;
alter table public.site_settings add column if not exists franchise_hero_image_url text;
alter table public.site_settings add column if not exists about_hero_image_url text;
alter table public.site_settings add column if not exists telegram_url text;
alter table public.site_settings add column if not exists instagram_url text;
alter table public.site_settings add column if not exists tiktok_url text;

insert into public.site_settings (id, site_name, theme, loyalty_enabled, loyalty_percent)
values ('main', 'KARIMOFF', 'light', true, 5)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
before update on public.site_settings
for each row
execute function public.set_updated_at();


-- ============================================================
-- Source: supabase/social-settings.sql
-- ============================================================

create table if not exists public.site_settings (
  id text primary key default 'main'
);

alter table public.site_settings add column if not exists telegram_url text;
alter table public.site_settings add column if not exists instagram_url text;
alter table public.site_settings add column if not exists tiktok_url text;

insert into public.site_settings (id)
values ('main')
on conflict (id) do nothing;

update public.site_settings
set
  telegram_url = coalesce(telegram_url, 'https://t.me/juikaifui'),
  instagram_url = coalesce(instagram_url, 'https://www.instagram.com/_guikaifui_/'),
  tiktok_url = coalesce(tiktok_url, 'https://www.tiktok.com/@karimich_11.0')
where id = 'main';


-- ============================================================
-- Source: supabase/product-images.sql
-- ============================================================

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



-- ============================================================
-- Source: supabase/ingredients.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/loyalty.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/avatar.sql
-- ============================================================

create table if not exists public.customer_avatars (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  base text default 'panda',
  eyes text default 'default',
  mouth text default 'smile',
  accessory text default 'none',
  clothes text default 'none',
  background text default 'orange'
);

alter table public.customer_avatars add column if not exists customer_id uuid references public.customers(id) on delete cascade;
alter table public.customer_avatars add column if not exists created_at timestamptz default now();
alter table public.customer_avatars add column if not exists updated_at timestamptz default now();
alter table public.customer_avatars add column if not exists base text default 'panda';
alter table public.customer_avatars add column if not exists eyes text default 'default';
alter table public.customer_avatars add column if not exists mouth text default 'smile';
alter table public.customer_avatars add column if not exists accessory text default 'none';
alter table public.customer_avatars add column if not exists clothes text default 'none';
alter table public.customer_avatars add column if not exists background text default 'orange';

create unique index if not exists customer_avatars_customer_id_key on public.customer_avatars (customer_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_avatars_set_updated_at on public.customer_avatars;
create trigger customer_avatars_set_updated_at
before update on public.customer_avatars
for each row
execute function public.set_updated_at();


-- ============================================================
-- Source: supabase/avatar-assets.sql
-- ============================================================

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



-- ============================================================
-- Source: supabase/vacancies.sql
-- ============================================================

create table if not exists public.vacancies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  title text not null,
  slug text unique not null,
  department text,
  employment_type text,
  salary_from numeric,
  salary_to numeric,
  salary_unit text default 'hour',
  location text,
  schedule text,
  description text,
  requirements text,
  responsibilities text,
  benefits text,
  is_active boolean default true,
  sort_order integer default 100
);

alter table public.vacancies add column if not exists updated_at timestamptz default now();
alter table public.vacancies add column if not exists title text;
alter table public.vacancies add column if not exists slug text;
alter table public.vacancies add column if not exists department text;
alter table public.vacancies add column if not exists employment_type text;
alter table public.vacancies add column if not exists salary_from numeric;
alter table public.vacancies add column if not exists salary_to numeric;
alter table public.vacancies add column if not exists salary_unit text default 'hour';
alter table public.vacancies add column if not exists location text;
alter table public.vacancies add column if not exists schedule text;
alter table public.vacancies add column if not exists description text;
alter table public.vacancies add column if not exists requirements text;
alter table public.vacancies add column if not exists responsibilities text;
alter table public.vacancies add column if not exists benefits text;
alter table public.vacancies add column if not exists is_active boolean default true;
alter table public.vacancies add column if not exists sort_order integer default 100;

create unique index if not exists vacancies_slug_idx on public.vacancies (slug);
create index if not exists vacancies_is_active_idx on public.vacancies (is_active);
create index if not exists vacancies_sort_order_idx on public.vacancies (sort_order);
create index if not exists vacancies_department_idx on public.vacancies (department);

create or replace function public.set_vacancies_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists vacancies_set_updated_at on public.vacancies;
create trigger vacancies_set_updated_at
before update on public.vacancies
for each row execute function public.set_vacancies_updated_at();


-- ============================================================
-- Source: supabase/cookie-consents.sql
-- ============================================================

create table if not exists public.cookie_consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  consent_id text,
  customer_id uuid null references public.customers(id) on delete set null,
  accepted boolean not null default true,
  categories jsonb default '{}'::jsonb,
  user_agent text,
  page_url text,
  ip_hash text null
);

alter table public.cookie_consents add column if not exists consent_id text;
alter table public.cookie_consents add column if not exists customer_id uuid null references public.customers(id) on delete set null;
alter table public.cookie_consents add column if not exists accepted boolean not null default true;
alter table public.cookie_consents add column if not exists categories jsonb default '{}'::jsonb;
alter table public.cookie_consents add column if not exists user_agent text;
alter table public.cookie_consents add column if not exists page_url text;
alter table public.cookie_consents add column if not exists ip_hash text null;

create index if not exists cookie_consents_created_at_idx on public.cookie_consents (created_at);
create index if not exists cookie_consents_consent_id_idx on public.cookie_consents (consent_id);
create index if not exists cookie_consents_customer_id_idx on public.cookie_consents (customer_id);
create index if not exists cookie_consents_accepted_idx on public.cookie_consents (accepted);


-- ============================================================
-- Source: supabase/economics-settings.sql
-- ============================================================

create table if not exists public.economics_settings (
  id text primary key default 'main',
  updated_at timestamptz default now(),
  average_check numeric default 0,
  orders_per_day numeric default 0,
  working_days_per_month numeric default 30,
  food_cost_percent numeric default 0,
  rent numeric default 0,
  payroll numeric default 0,
  utilities numeric default 0,
  marketing numeric default 0,
  other_expenses numeric default 0,
  equipment numeric default 0,
  renovation numeric default 0,
  furniture numeric default 0,
  launch_marketing numeric default 0,
  other_capex numeric default 0,
  royalty_percent numeric default 0,
  acquiring_percent numeric default 0,
  tax_percent numeric default 0,
  misc_percent numeric default 0
);

alter table public.economics_settings add column if not exists updated_at timestamptz default now();
alter table public.economics_settings add column if not exists average_check numeric default 0;
alter table public.economics_settings add column if not exists orders_per_day numeric default 0;
alter table public.economics_settings add column if not exists working_days_per_month numeric default 30;
alter table public.economics_settings add column if not exists food_cost_percent numeric default 0;
alter table public.economics_settings add column if not exists rent numeric default 0;
alter table public.economics_settings add column if not exists payroll numeric default 0;
alter table public.economics_settings add column if not exists utilities numeric default 0;
alter table public.economics_settings add column if not exists marketing numeric default 0;
alter table public.economics_settings add column if not exists other_expenses numeric default 0;
alter table public.economics_settings add column if not exists equipment numeric default 0;
alter table public.economics_settings add column if not exists renovation numeric default 0;
alter table public.economics_settings add column if not exists furniture numeric default 0;
alter table public.economics_settings add column if not exists launch_marketing numeric default 0;
alter table public.economics_settings add column if not exists other_capex numeric default 0;
alter table public.economics_settings add column if not exists royalty_percent numeric default 0;
alter table public.economics_settings add column if not exists acquiring_percent numeric default 0;
alter table public.economics_settings add column if not exists tax_percent numeric default 0;
alter table public.economics_settings add column if not exists misc_percent numeric default 0;

insert into public.economics_settings (
  id,
  average_check,
  orders_per_day,
  working_days_per_month,
  food_cost_percent,
  rent,
  payroll,
  utilities,
  marketing,
  other_expenses,
  equipment,
  renovation,
  furniture,
  launch_marketing,
  other_capex,
  royalty_percent,
  acquiring_percent,
  tax_percent,
  misc_percent
)
values (
  'main',
  430,
  120,
  30,
  35,
  180000,
  450000,
  60000,
  80000,
  50000,
  2200000,
  1500000,
  500000,
  300000,
  200000,
  5,
  2.2,
  6,
  2
)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists economics_settings_set_updated_at on public.economics_settings;
create trigger economics_settings_set_updated_at
before update on public.economics_settings
for each row
execute function public.set_updated_at();


-- ============================================================
-- Source: supabase/inventory.sql
-- ============================================================

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
