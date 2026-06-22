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
