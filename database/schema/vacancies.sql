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
