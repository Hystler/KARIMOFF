create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  phone text unique not null,
  last_login_at timestamptz
);

create table if not exists public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

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
