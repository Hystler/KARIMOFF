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
