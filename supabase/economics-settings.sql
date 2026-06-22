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
