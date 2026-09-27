alter table public.ingredients
  add column if not exists waste_percent numeric not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingredients_waste_percent_check'
      and conrelid = 'public.ingredients'::regclass
  ) then
    alter table public.ingredients
      add constraint ingredients_waste_percent_check
      check (waste_percent >= 0 and waste_percent <= 95);
  end if;
end
$$;

create or replace function public.apply_ingredient_waste_to_order_usage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_waste_percent numeric := 0;
begin
  select coalesce(waste_percent, 0)
  into v_waste_percent
  from public.ingredients
  where id = new.ingredient_id;

  if new.quantity_per_item > 0 and v_waste_percent > 0 then
    new.quantity_per_item := new.quantity_per_item / (1 - v_waste_percent / 100);
  end if;

  return new;
end;
$$;

drop trigger if exists order_item_usage_apply_waste on public.order_item_ingredient_usage;
create trigger order_item_usage_apply_waste
before insert on public.order_item_ingredient_usage
for each row execute function public.apply_ingredient_waste_to_order_usage();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_requested_at_same_moscow_day_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_requested_at_same_moscow_day_check
      check (
        (fulfillment_mode = 'asap' and requested_at is null)
        or (
          fulfillment_mode = 'scheduled'
          and requested_at is not null
          and requested_at >= created_at + interval '15 minutes'
          and (requested_at at time zone 'Europe/Moscow')::date =
              (created_at at time zone 'Europe/Moscow')::date
        )
      ) not valid;
  end if;
end
$$;

create index if not exists cash_register_events_created_idx
  on public.cash_register_events (created_at desc);

create index if not exists cash_register_events_type_created_idx
  on public.cash_register_events (event_type, created_at desc);
