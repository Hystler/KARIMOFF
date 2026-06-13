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
