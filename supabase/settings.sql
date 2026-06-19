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
  hero_subtitle text
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
