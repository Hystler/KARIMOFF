-- Canonical multi-channel order flow, KDS lifecycle, reliable Evotor cursors,
-- and a PostgreSQL outbox. This migration is additive and keeps the existing
-- inventory and analytics functions available for rollback.

create table if not exists public.order_locations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  location_key text not null unique,
  name text not null,
  timezone text not null default 'Europe/Moscow',
  address text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

insert into public.order_locations (
  id, location_key, name, timezone, is_default, is_active
)
values (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'karimoff-main',
  'KARIMOFF',
  'Europe/Moscow',
  true,
  true
)
on conflict (location_key) do update
set name = excluded.name,
    timezone = excluded.timezone,
    is_active = true;

create unique index if not exists order_locations_one_default_idx
  on public.order_locations (is_default)
  where is_default;

alter table public.orders add column if not exists location_id uuid;
alter table public.orders add column if not exists display_prefix text;
alter table public.orders add column if not exists daily_sequence integer;
alter table public.orders add column if not exists display_number text;
alter table public.orders add column if not exists display_date date;
alter table public.orders add column if not exists source_external_id text;
alter table public.orders add column if not exists kitchen_status text not null default 'new';
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists cooking_started_at timestamptz;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists handed_out_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists public_display_name text;
alter table public.orders add column if not exists public_avatar_seed text;
alter table public.orders add column if not exists public_avatar_config jsonb;
alter table public.orders add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.orders alter column customer_name drop not null;
alter table public.orders alter column customer_phone drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_location_fk'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_location_fk
      foreign key (location_id) references public.order_locations(id) on delete restrict;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'orders_source_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_source_check;
  end if;
  alter table public.orders
    add constraint orders_source_check
    check (source in ('site', 'web', 'pos', 'mobile', 'kiosk', 'aggregator')) not valid;

  if exists (
    select 1 from pg_constraint
    where conname = 'orders_kitchen_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_kitchen_status_check;
  end if;
  alter table public.orders
    add constraint orders_kitchen_status_check
    check (kitchen_status in ('new', 'accepted', 'cooking', 'ready', 'handed_out', 'cancelled')) not valid;

  if exists (
    select 1 from pg_constraint
    where conname = 'staff_users_role_check'
      and conrelid = 'public.staff_users'::regclass
  ) then
    alter table public.staff_users drop constraint staff_users_role_check;
  end if;
  alter table public.staff_users
    add constraint staff_users_role_check
    check (role in ('owner', 'admin', 'manager', 'cashier', 'cook')) not valid;
end
$$;

update public.orders
set location_id = '00000000-0000-4000-8000-000000000001'::uuid,
    kitchen_status = case
      when status = 'completed' then 'handed_out'
      when status = 'cancelled' then 'cancelled'
      when status = 'in_progress' then 'cooking'
      else 'new'
    end,
    public_display_name = left(coalesce(nullif(btrim(customer_name), ''), 'Гость'), 40),
    public_avatar_seed = coalesce(public_avatar_seed, md5(id::text))
where location_id is null
   or public_display_name is null
   or public_avatar_seed is null;

update public.orders order_row
set public_avatar_config = jsonb_build_object(
  'base', avatar.base,
  'eyes', avatar.eyes,
  'mouth', avatar.mouth,
  'accessory', avatar.accessory,
  'clothes', avatar.clothes,
  'background', avatar.background
)
from public.customer_avatars avatar
where avatar.customer_id = order_row.customer_id
  and order_row.public_avatar_config is null;

alter table public.orders
  alter column location_id set default '00000000-0000-4000-8000-000000000001'::uuid;

create unique index if not exists orders_location_display_number_key
  on public.orders (location_id, display_date, display_number)
  where display_number is not null;
create unique index if not exists orders_source_external_key
  on public.orders (source, source_external_id)
  where source_external_id is not null;
create index if not exists orders_kds_queue_idx
  on public.orders (location_id, kitchen_status, created_at)
  where kitchen_status in ('new', 'accepted', 'cooking', 'ready');
create index if not exists orders_display_ready_idx
  on public.orders (location_id, ready_at desc)
  where kitchen_status in ('cooking', 'ready');
create index if not exists orders_display_date_idx
  on public.orders (location_id, display_date, daily_sequence);

create table if not exists public.order_number_counters (
  location_id uuid not null references public.order_locations(id) on delete cascade,
  business_date date not null,
  prefix text not null,
  last_value integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (location_id, business_date, prefix),
  constraint order_number_counters_prefix_check check (prefix ~ '^[A-Z]$'),
  constraint order_number_counters_value_check check (last_value >= 0)
);

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  actor_role text,
  device_source text not null default 'admin',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists order_status_events_order_time_idx
  on public.order_status_events (order_id, occurred_at, id);
create index if not exists order_status_events_status_time_idx
  on public.order_status_events (to_status, occurred_at desc);

create table if not exists public.order_outbox (
  id bigint generated always as identity primary key,
  aggregate_type text not null default 'order',
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists order_outbox_pending_idx
  on public.order_outbox (available_at, id)
  where published_at is null;
create index if not exists order_outbox_order_idx
  on public.order_outbox (aggregate_id, id desc);

create table if not exists public.kitchen_sla_settings (
  location_id uuid primary key references public.order_locations(id) on delete cascade,
  warning_seconds integer not null default 300,
  critical_seconds integer not null default 480,
  ready_display_seconds integer not null default 900,
  online_requires_paid boolean not null default false,
  pos_requires_paid boolean not null default false,
  inventory_trigger text not null default 'ready',
  updated_at timestamptz not null default now(),
  constraint kitchen_sla_threshold_check check (
    warning_seconds between 60 and 7200
    and critical_seconds > warning_seconds
    and critical_seconds <= 14400
    and ready_display_seconds between 30 and 86400
  ),
  constraint kitchen_sla_inventory_trigger_check
    check (inventory_trigger = 'ready')
);

insert into public.kitchen_sla_settings (location_id)
values ('00000000-0000-4000-8000-000000000001'::uuid)
on conflict (location_id) do nothing;

alter table public.staff_location_access add column if not exists order_location_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_location_access_order_location_fk'
      and conrelid = 'public.staff_location_access'::regclass
  ) then
    alter table public.staff_location_access
      add constraint staff_location_access_order_location_fk
      foreign key (order_location_id) references public.order_locations(id) on delete cascade;
  end if;
end
$$;

update public.staff_location_access access
set order_location_id = location.id
from public.order_locations location
where access.order_location_id is null
  and access.location_key in (
    location.location_key,
    'order:location:' || location.id::text
  );

insert into public.staff_location_access (staff_id, location_key, order_location_id)
select staff.id, 'order:location:' || location.id::text, location.id
from public.staff_users staff
cross join lateral (
  select id from public.order_locations
  where is_default and is_active
  order by created_at
  limit 1
) location
where staff.is_active
  and not exists (
    select 1 from public.staff_location_access access
    where access.staff_id = staff.id
      and access.order_location_id = location.id
  )
on conflict (staff_id, location_key) do update
set order_location_id = excluded.order_location_id;

create unique index if not exists staff_location_access_order_location_idx
  on public.staff_location_access (staff_id, order_location_id)
  where order_location_id is not null;

create or replace function public.assign_default_location_to_staff()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid;
begin
  select id into v_location_id
  from public.order_locations
  where is_default and is_active
  order by created_at
  limit 1;
  if v_location_id is not null then
    insert into public.staff_location_access (staff_id, location_key, order_location_id)
    values (new.id, 'order:location:' || v_location_id::text, v_location_id)
    on conflict (staff_id, location_key) do update
    set order_location_id = excluded.order_location_id;
  end if;
  return new;
end
$$;

drop trigger if exists staff_users_assign_default_location on public.staff_users;
create trigger staff_users_assign_default_location
after insert on public.staff_users
for each row execute function public.assign_default_location_to_staff();

alter table public.product_ingredients add column if not exists preparation_step text;
alter table public.product_ingredients add column if not exists preparation_note text;
alter table public.product_ingredients add column if not exists preparation_image_url text;
alter table public.product_ingredients add column if not exists station text;
alter table public.product_ingredients add column if not exists preparation_time_seconds integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_ingredients_station_check'
      and conrelid = 'public.product_ingredients'::regclass
  ) then
    alter table public.product_ingredients
      add constraint product_ingredients_station_check
      check (station is null or station in ('grill', 'fryer', 'assembly', 'drinks', 'packing')) not valid;
  end if;
end
$$;

alter table public.evotor_stores add column if not exists location_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evotor_stores_location_fk'
      and conrelid = 'public.evotor_stores'::regclass
  ) then
    alter table public.evotor_stores
      add constraint evotor_stores_location_fk
      foreign key (location_id) references public.order_locations(id) on delete set null;
  end if;
end
$$;

update public.evotor_stores
set location_id = '00000000-0000-4000-8000-000000000001'::uuid
where location_id is null;

create index if not exists evotor_stores_location_idx
  on public.evotor_stores (location_id, synchronized_at desc);

alter table public.evotor_connections add column if not exists last_event_received_at timestamptz;
alter table public.evotor_connections add column if not exists last_sync_started_at timestamptz;
alter table public.evotor_connections add column if not exists last_cursor_at timestamptz;
alter table public.evotor_connections add column if not exists last_imported_receipts integer not null default 0;
alter table public.evotor_connections add column if not exists last_updated_receipts integer not null default 0;
alter table public.evotor_connections add column if not exists failed_items integer not null default 0;
alter table public.evotor_connections add column if not exists retry_count integer not null default 0;
alter table public.evotor_receipts add column if not exists source_hash text;
create index if not exists evotor_receipts_source_hash_idx
  on public.evotor_receipts (connection_id, source_hash)
  where source_hash is not null;

alter table public.evotor_sync_events add column if not exists retry_count integer not null default 0;
alter table public.evotor_sync_events add column if not exists available_at timestamptz not null default now();
alter table public.evotor_sync_events add column if not exists cursor_before timestamptz;
alter table public.evotor_sync_events add column if not exists cursor_after timestamptz;
alter table public.evotor_sync_events add column if not exists imported_count integer not null default 0;
alter table public.evotor_sync_events add column if not exists updated_count integer not null default 0;
alter table public.evotor_sync_events add column if not exists failed_count integer not null default 0;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'evotor_sync_events_sync_type_check'
      and conrelid = 'public.evotor_sync_events'::regclass
  ) then
    alter table public.evotor_sync_events drop constraint evotor_sync_events_sync_type_check;
  end if;
  alter table public.evotor_sync_events
    add constraint evotor_sync_events_sync_type_check
    check (sync_type in (
      'initial', 'manual', 'check', 'installation', 'uninstallation',
      'incremental', 'reconciliation', 'webhook'
    )) not valid;
end
$$;

create table if not exists public.evotor_sync_cursors (
  connection_id uuid not null references public.evotor_connections(id) on delete cascade,
  store_id uuid not null references public.evotor_stores(id) on delete cascade,
  cursor_time timestamptz,
  last_document_id text,
  overlap_seconds integer not null default 300,
  last_incremental_at timestamptz,
  last_reconciled_at timestamptz,
  last_seen_document_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (connection_id, store_id),
  constraint evotor_sync_cursors_overlap_check check (overlap_seconds between 60 and 86400)
);

create table if not exists public.evotor_inbound_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.evotor_connections(id) on delete cascade,
  event_type text not null,
  external_id text not null,
  payload_hash text not null,
  status text not null default 'received'
    check (status in ('received', 'queued', 'processed', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  unique (connection_id, event_type, external_id)
);

create index if not exists evotor_sync_events_queue_idx
  on public.evotor_sync_events (status, available_at, created_at)
  where status = 'pending';
create index if not exists evotor_sync_cursors_due_idx
  on public.evotor_sync_cursors (last_incremental_at, last_reconciled_at);
create index if not exists evotor_inbound_events_status_idx
  on public.evotor_inbound_events (status, received_at);

create or replace function public.next_order_sequence(
  p_location_id uuid,
  p_prefix text,
  p_business_date date
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sequence integer;
begin
  if p_prefix !~ '^[A-Z]$' then
    raise exception using errcode = 'P0001', message = 'Некорректный префикс заказа.';
  end if;

  insert into public.order_number_counters (
    location_id, business_date, prefix, last_value, updated_at
  ) values (
    p_location_id, p_business_date, p_prefix, 1, now()
  )
  on conflict (location_id, business_date, prefix)
  do update set
    last_value = public.order_number_counters.last_value + 1,
    updated_at = now()
  returning last_value into v_sequence;

  return v_sequence;
end
$$;

create or replace function public.initialize_order_flow_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_source text;
begin
  if new.location_id is null then
    select id into new.location_id
    from public.order_locations
    where is_default and is_active
    order by created_at
    limit 1;
  end if;

  if new.location_id is null then
    raise exception using errcode = 'P0001', message = 'Не настроена точка выполнения заказа.';
  end if;

  select timezone into v_timezone
  from public.order_locations
  where id = new.location_id and is_active;

  if v_timezone is null then
    raise exception using errcode = 'P0001', message = 'Точка заказа отключена или не найдена.';
  end if;

  v_source := lower(coalesce(nullif(new.source, ''), 'web'));
  if v_source = 'site' then v_source := 'web'; end if;
  if v_source not in ('web', 'pos', 'mobile', 'kiosk', 'aggregator') then
    raise exception using errcode = 'P0001', message = 'Некорректный источник заказа.';
  end if;
  new.source := v_source;

  if new.display_prefix is null then
    new.display_prefix := case
      when v_source in ('web', 'mobile') then 'A'
      when v_source in ('pos', 'kiosk') then 'B'
      else 'C'
    end;
  end if;

  new.display_date := coalesce(
    new.display_date,
    (coalesce(new.created_at, now()) at time zone v_timezone)::date
  );
  if new.daily_sequence is null then
    new.daily_sequence := public.next_order_sequence(
      new.location_id,
      new.display_prefix,
      new.display_date
    );
  end if;
  new.display_number := coalesce(
    new.display_number,
    new.display_prefix || '-' || lpad(new.daily_sequence::text, 3, '0')
  );
  new.customer_name := coalesce(nullif(btrim(new.customer_name), ''), 'Гость');
  new.public_display_name := left(
    regexp_replace(
      coalesce(nullif(btrim(new.public_display_name), ''), new.customer_name, 'Гость'),
      '\s+.*$',
      ''
    ),
    40
  );
  new.public_avatar_seed := coalesce(
    nullif(new.public_avatar_seed, ''),
    md5(coalesce(new.id::text, gen_random_uuid()::text))
  );
  if new.public_avatar_config is null and new.customer_id is not null then
    select jsonb_build_object(
      'base', avatar.base,
      'eyes', avatar.eyes,
      'mouth', avatar.mouth,
      'accessory', avatar.accessory,
      'clothes', avatar.clothes,
      'background', avatar.background
    ) into new.public_avatar_config
    from public.customer_avatars avatar
    where avatar.customer_id = new.customer_id;
  end if;
  new.kitchen_status := coalesce(nullif(new.kitchen_status, ''), 'new');
  return new;
end
$$;

drop trigger if exists orders_initialize_order_flow on public.orders;
create trigger orders_initialize_order_flow
before insert on public.orders
for each row execute function public.initialize_order_flow_before_insert();

create or replace function public.emit_order_created_after_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.order_status_events (
    order_id, from_status, to_status, actor_user_id, actor_role,
    device_source, metadata
  ) values (
    new.id, null, 'new', null, null, new.source,
    jsonb_build_object('display_number', new.display_number)
  );

  insert into public.order_outbox (
    aggregate_id, event_type, payload, idempotency_key
  ) values (
    new.id,
    'order.created',
    jsonb_build_object('order_id', new.id, 'location_id', new.location_id),
    'order:' || new.id || ':created'
  ) on conflict (idempotency_key) do nothing;
  return new;
end
$$;

drop trigger if exists orders_emit_created on public.orders;
create trigger orders_emit_created
after insert on public.orders
for each row execute function public.emit_order_created_after_insert();

create or replace function public.notify_order_outbox()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_notify('karimoff_order_events', new.id::text);
  return new;
end
$$;

drop trigger if exists order_outbox_notify on public.order_outbox;
create trigger order_outbox_notify
after insert on public.order_outbox
for each row execute function public.notify_order_outbox();

create or replace function public.populate_order_items_atomic(
  p_order_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_removed jsonb;
  v_extras jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_order_item_id uuid;
  v_quantity integer;
  v_total_quantity integer := 0;
  v_total numeric := 0;
  v_extra_total numeric;
  v_line_unit_price numeric;
  v_has_composition boolean;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 50
  then
    raise exception using errcode = 'P0001', message = 'Корзина пуста или содержит слишком много позиций.';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select (item->>'product_id')::uuid
    from jsonb_array_elements(p_items) item
  )
  order by p.id
  for share;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception using errcode = 'P0001', message = 'Некорректная позиция заказа.';
    end;

    if v_quantity < 1 or v_quantity > 20 then
      raise exception using errcode = 'P0001', message = 'Количество одной позиции должно быть от 1 до 20.';
    end if;
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 50 then
      raise exception using errcode = 'P0001', message = 'В заказе может быть не более 50 товаров.';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and is_active = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'Один из товаров недоступен или удалён.';
    end if;

    v_removed := coalesce(v_item->'removed_ingredient_ids', '[]'::jsonb);
    v_extras := coalesce(v_item->'extras', '[]'::jsonb);
    if jsonb_typeof(v_removed) <> 'array' or jsonb_typeof(v_extras) <> 'array' then
      raise exception using errcode = 'P0001', message = 'Некорректные изменения состава.';
    end if;
    if jsonb_array_length(v_removed) > 20 or jsonb_array_length(v_extras) > 20 then
      raise exception using errcode = 'P0001', message = 'Слишком много изменений состава.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_removed) x(ingredient_id)
      left join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id::uuid
       and pi.is_removable = true
      where pi.id is null
    ) then
      raise exception using errcode = 'P0001', message = 'Один из ингредиентов нельзя убрать.';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
      left join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id
       and pi.is_extra_available = true
      where pi.id is null
        or x.quantity is null
        or x.quantity < 1
        or x.quantity > pi.max_extra_quantity
    ) then
      raise exception using errcode = 'P0001', message = 'Одна из добавок недоступна или превышен лимит.';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
      join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id
      group by x.ingredient_id, pi.max_extra_quantity
      having sum(x.quantity) > pi.max_extra_quantity
    ) then
      raise exception using errcode = 'P0001', message = 'Превышен лимит добавки.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_removed) removed(ingredient_id)
      join jsonb_to_recordset(v_extras) extra(ingredient_id uuid, quantity integer)
        on extra.ingredient_id = removed.ingredient_id::uuid
    ) then
      raise exception using errcode = 'P0001', message = 'Нельзя одновременно убрать и добавить один ингредиент.';
    end if;

    select coalesce(sum(pi.extra_price * x.quantity), 0)
    into v_extra_total
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true;
    v_line_unit_price := v_product.price + v_extra_total;

    select exists (
      select 1 from public.product_ingredients pi
      where pi.product_id = v_product_id and pi.quantity > 0
    ) into v_has_composition;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity,
      line_total, inventory_snapshot_ready
    ) values (
      p_order_id, v_product.id, v_product.name, v_line_unit_price, v_quantity,
      v_line_unit_price * v_quantity, v_has_composition
    ) returning id into v_order_item_id;

    insert into public.order_item_modifiers (
      order_item_id, ingredient_id, modifier_type, ingredient_name,
      quantity, unit, unit_price_delta, line_price_delta
    )
    select v_order_item_id, pi.ingredient_id, 'remove', i.name,
      pi.quantity, pi.unit, 0, 0
    from jsonb_array_elements_text(v_removed) x(ingredient_id)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id::uuid
     and pi.is_removable = true
    join public.ingredients i on i.id = pi.ingredient_id;

    insert into public.order_item_modifiers (
      order_item_id, ingredient_id, modifier_type, ingredient_name,
      quantity, unit, unit_price_delta, line_price_delta
    )
    select v_order_item_id, pi.ingredient_id, 'add', i.name,
      pi.extra_quantity * sum(x.quantity), pi.unit,
      pi.extra_price * sum(x.quantity),
      pi.extra_price * sum(x.quantity) * v_quantity
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true
    join public.ingredients i on i.id = pi.ingredient_id
    group by pi.ingredient_id, i.name, pi.extra_quantity, pi.unit, pi.extra_price;

    insert into public.order_item_ingredient_usage (
      order_item_id, ingredient_id, ingredient_name, quantity_per_item, unit
    )
    select v_order_item_id, pi.ingredient_id, i.name, pi.quantity, pi.unit
    from public.product_ingredients pi
    join public.ingredients i on i.id = pi.ingredient_id
    where pi.product_id = v_product_id
      and pi.quantity > 0
      and not exists (
        select 1
        from jsonb_array_elements_text(v_removed) x(ingredient_id)
        where x.ingredient_id::uuid = pi.ingredient_id
      );

    insert into public.order_item_ingredient_usage (
      order_item_id, ingredient_id, ingredient_name, quantity_per_item, unit
    )
    select v_order_item_id, pi.ingredient_id, i.name,
      pi.extra_quantity * sum(x.quantity), pi.unit
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true
    join public.ingredients i on i.id = pi.ingredient_id
    group by pi.ingredient_id, i.name, pi.extra_quantity, pi.unit
    on conflict (order_item_id, ingredient_id)
    do update set quantity_per_item =
      public.order_item_ingredient_usage.quantity_per_item
      + excluded.quantity_per_item;

    v_total := v_total + v_line_unit_price * v_quantity;
  end loop;

  return v_total;
end
$$;

create or replace function public.create_site_order(
  p_customer_id uuid,
  p_delivery_type text,
  p_address text,
  p_comment text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_personal_data_granted boolean,
  p_offer_accepted boolean,
  p_marketing_granted boolean,
  p_document_version text,
  p_source_path text,
  p_user_agent_short text,
  p_fulfillment_mode text,
  p_requested_at timestamptz
)
returns table(order_id uuid, total numeric)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_total numeric;
begin
  if not p_personal_data_granted then
    raise exception using errcode = 'P0001', message = 'Требуется согласие на обработку персональных данных.';
  end if;
  if not p_offer_accepted then
    raise exception using errcode = 'P0001', message = 'Требуется принять публичную оферту.';
  end if;
  if p_delivery_type not in ('pickup', 'delivery') then
    raise exception using errcode = 'P0001', message = 'Некорректный тип получения.';
  end if;
  if p_delivery_type = 'delivery' and nullif(btrim(coalesce(p_address, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'Укажите адрес доставки.';
  end if;
  if p_fulfillment_mode not in ('asap', 'scheduled') then
    raise exception using errcode = 'P0001', message = 'Некорректное время получения.';
  end if;
  if p_fulfillment_mode = 'scheduled' and (
    p_requested_at is null
    or p_requested_at < now() + interval '15 minutes'
    or (p_requested_at at time zone 'Europe/Moscow')::date <>
       (now() at time zone 'Europe/Moscow')::date
  ) then
    raise exception using errcode = 'P0001', message = 'Выберите доступное время получения на сегодня.';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Профиль клиента не найден.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.orders
    where idempotency_key = p_idempotency_key
    for update;
    if found then
      if v_existing.customer_id <> p_customer_id then
        raise exception using errcode = 'P0001', message = 'Некорректный ключ повторного запроса.';
      end if;
      return query select v_existing.id, v_existing.total;
      return;
    end if;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, public_display_name,
    delivery_type, address, comment, status, total, source,
    idempotency_key, payment_status, fiscal_status, fulfillment_mode,
    requested_at, source_metadata
  ) values (
    v_customer.id, v_customer.name, v_customer.phone, v_customer.name,
    p_delivery_type,
    case when p_delivery_type = 'delivery' then nullif(btrim(p_address), '') else null end,
    nullif(btrim(coalesce(p_comment, '')), ''),
    'new', 0, 'web', p_idempotency_key, 'not_required', 'not_required',
    p_fulfillment_mode,
    case when p_fulfillment_mode = 'scheduled' then p_requested_at else null end,
    jsonb_build_object('channel', 'web')
  ) returning id into v_order_id;

  v_total := public.populate_order_items_atomic(v_order_id, p_items);
  update public.orders set total = v_total, updated_at = now() where id = v_order_id;

  insert into public.legal_consents (
    subject_type, subject_id, consent_type, document_version, granted,
    granted_at, revoked_at, source_path, user_agent_short
  ) values
    ('customer', v_customer.id, 'personal_data', p_document_version, true, now(), null, p_source_path, left(p_user_agent_short, 255)),
    ('customer', v_customer.id, 'offer_acceptance', p_document_version, true, now(), null, p_source_path, left(p_user_agent_short, 255)),
    (
      'customer', v_customer.id, 'marketing', p_document_version, p_marketing_granted,
      case when p_marketing_granted then now() else null end,
      case when p_marketing_granted then null else now() end,
      p_source_path, left(p_user_agent_short, 255)
    );

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id,
    metadata, source_path, user_agent_short
  ) values (
    'customer', v_customer.id, 'order.create', 'order', v_order_id::text,
    jsonb_build_object(
      'total', v_total,
      'delivery_type', p_delivery_type,
      'fulfillment_mode', p_fulfillment_mode,
      'requested_at', p_requested_at
    ),
    p_source_path, left(p_user_agent_short, 255)
  );

  return query select v_order_id, v_total;
end
$$;

create or replace function public.create_pos_order_atomic(
  p_location_id uuid,
  p_customer_name text,
  p_comment text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_fulfillment_mode text default 'asap',
  p_requested_at timestamptz default null
)
returns table(order_id uuid, total numeric, display_number text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_total numeric;
  v_display_number text;
begin
  if p_actor_role not in ('owner', 'admin', 'manager', 'cashier') then
    raise exception using errcode = 'P0001', message = 'Недостаточно прав для создания заказа на кассе.';
  end if;
  if p_fulfillment_mode not in ('asap', 'scheduled') then
    raise exception using errcode = 'P0001', message = 'Некорректное время получения.';
  end if;
  if p_fulfillment_mode = 'scheduled' and (
    p_requested_at is null
    or p_requested_at < now() + interval '15 minutes'
    or (p_requested_at at time zone 'Europe/Moscow')::date <>
       (now() at time zone 'Europe/Moscow')::date
  ) then
    raise exception using errcode = 'P0001', message = 'Выберите доступное время получения на сегодня.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.orders
    where idempotency_key = p_idempotency_key
    for update;
    if found then
      if v_existing.source <> 'pos' or v_existing.location_id <> p_location_id then
        raise exception using errcode = 'P0001', message = 'Некорректный ключ повторного запроса.';
      end if;
      return query select v_existing.id, v_existing.total, v_existing.display_number;
      return;
    end if;
  end if;

  insert into public.orders (
    location_id, customer_name, customer_phone, public_display_name,
    delivery_type, comment, status, total, source, idempotency_key,
    payment_status, fiscal_status, fulfillment_mode, requested_at,
    source_metadata
  ) values (
    p_location_id,
    coalesce(nullif(btrim(p_customer_name), ''), 'Гость'),
    null,
    coalesce(nullif(btrim(p_customer_name), ''), 'Гость'),
    'pickup',
    nullif(btrim(coalesce(p_comment, '')), ''),
    'new',
    0,
    'pos',
    p_idempotency_key,
    'not_required',
    'pending',
    p_fulfillment_mode,
    case when p_fulfillment_mode = 'scheduled' then p_requested_at else null end,
    jsonb_build_object('created_by_staff_id', p_actor_id, 'created_by_role', p_actor_role)
  ) returning id, orders.display_number into v_order_id, v_display_number;

  v_total := public.populate_order_items_atomic(v_order_id, p_items);
  update public.orders set total = v_total, updated_at = now() where id = v_order_id;

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, metadata, source_path
  ) values (
    'staff', p_actor_id, 'order.pos_create', 'order', v_order_id::text,
    jsonb_build_object('total', v_total, 'display_number', v_display_number),
    '/pos'
  );

  return query select v_order_id, v_total, v_display_number;
end
$$;

create or replace function public.set_order_kitchen_status_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid default null,
  p_actor_role text default 'admin',
  p_device_source text default 'admin'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_business_status text;
  v_warnings jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_status not in ('new', 'accepted', 'cooking', 'ready', 'handed_out', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус кухни.';
  end if;
  if p_actor_role not in ('owner', 'admin', 'manager', 'cashier', 'cook') then
    raise exception using errcode = 'P0001', message = 'Некорректная роль сотрудника.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ не найден.';
  end if;
  if v_order.kitchen_status = p_status then
    return jsonb_build_object('ok', true, 'already_applied', true, 'warnings', v_warnings);
  end if;

  if p_status = 'cancelled' and v_order.kitchen_status in ('ready', 'handed_out') then
    raise exception using
      errcode = 'P0001',
      message = 'Готовый заказ нельзя отменить без оформления возврата и обратного движения склада.';
  end if;

  if p_actor_role = 'cook' and not (
    (v_order.kitchen_status = 'new' and p_status = 'accepted')
    or (v_order.kitchen_status = 'accepted' and p_status = 'cooking')
    or (v_order.kitchen_status = 'cooking' and p_status = 'ready')
  ) then
    raise exception using errcode = 'P0001', message = 'Этот переход недоступен для роли повара.';
  end if;
  if p_actor_role = 'cashier' and not (
    v_order.kitchen_status = 'ready' and p_status = 'handed_out'
  ) then
    raise exception using errcode = 'P0001', message = 'Кассир может только отметить выдачу готового заказа.';
  end if;

  if p_status <> 'cancelled' and not (
    (v_order.kitchen_status = 'new' and p_status = 'accepted')
    or (v_order.kitchen_status = 'accepted' and p_status = 'cooking')
    or (v_order.kitchen_status = 'cooking' and p_status = 'ready')
    or (v_order.kitchen_status = 'ready' and p_status = 'handed_out')
  ) then
    raise exception using errcode = 'P0001', message = 'Недопустимый переход статуса заказа.';
  end if;

  v_business_status := case
    when p_status = 'new' then 'new'
    when p_status in ('accepted', 'cooking') then 'in_progress'
    when p_status in ('ready', 'handed_out') then 'completed'
    else 'cancelled'
  end;

  if p_status = 'ready' then
    select public.set_order_status_staff_atomic(
      p_order_id,
      'completed',
      p_actor_id,
      case when p_actor_role = 'owner' then 'admin' else p_actor_role end,
      p_device_source
    ) into v_result;
    v_warnings := coalesce(v_result->'warnings', '[]'::jsonb);
  elsif p_status = 'cancelled' then
    select public.set_order_status_staff_atomic(
      p_order_id,
      'cancelled',
      p_actor_id,
      case when p_actor_role = 'owner' then 'admin' else p_actor_role end,
      p_device_source
    ) into v_result;
    v_warnings := coalesce(v_result->'warnings', '[]'::jsonb);
  elsif v_order.status <> v_business_status then
    update public.orders
    set status = v_business_status, updated_at = now()
    where id = p_order_id;
  end if;

  update public.orders
  set kitchen_status = p_status,
      updated_at = now(),
      assigned_staff_id = case
        when p_actor_id is not null and p_status in ('accepted', 'cooking', 'ready')
          then coalesce(assigned_staff_id, p_actor_id)
        else assigned_staff_id
      end,
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      cooking_started_at = case when p_status = 'cooking' then coalesce(cooking_started_at, now()) else cooking_started_at end,
      ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
      handed_out_at = case when p_status = 'handed_out' then coalesce(handed_out_at, now()) else handed_out_at end,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_order_id;

  insert into public.order_status_events (
    order_id, from_status, to_status, actor_user_id, actor_role,
    device_source, metadata
  ) values (
    p_order_id, v_order.kitchen_status, p_status, p_actor_id, p_actor_role,
    p_device_source, jsonb_build_object('warnings', v_warnings)
  );

  insert into public.order_outbox (
    aggregate_id, event_type, payload, idempotency_key
  ) values (
    p_order_id,
    'order.status_changed',
    jsonb_build_object(
      'order_id', p_order_id,
      'location_id', v_order.location_id,
      'from', v_order.kitchen_status,
      'to', p_status
    ),
    'order:' || p_order_id || ':status:' || p_status
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'warnings', v_warnings);
end
$$;

create or replace view public.canonical_analytics_sales
with (security_invoker = true)
as
select
  s.sale_id,
  s.source_record_id,
  s.external_source_id,
  case
    when o.source in ('pos', 'kiosk') then 'pos_evotor'
    when o.source = 'mobile' then 'mobile'
    when o.source = 'aggregator' then 'aggregator'
    else s.source
  end as source,
  case when o.id is not null then o.source else s.source_subtype end as source_subtype,
  case when o.id is not null then 'order:location:' || o.location_id::text else s.location_id end as location_id,
  coalesce(l.name, s.location_name) as location_name,
  s.terminal_id,
  s.terminal_name,
  s.employee_id,
  s.employee_name,
  s.customer_id,
  s.customer_name,
  coalesce(o.display_number, s.order_number) as order_number,
  s.opened_at,
  s.paid_at,
  s.completed_at,
  s.analytics_at,
  s.status,
  s.operation_type,
  s.gross_amount,
  s.discount_amount,
  s.refund_amount,
  s.net_revenue,
  s.payment_method,
  s.items_count,
  s.currency,
  s.analytics_included,
  s.sale_count_eligible,
  s.discount_data_available,
  s.source_updated_at,
  s.source_metadata
from public.analytics_sales s
left join public.orders o
  on s.sale_id = 'web:' || o.id::text
left join public.order_locations l on l.id = o.location_id;

drop trigger if exists order_locations_set_updated_at on public.order_locations;
create trigger order_locations_set_updated_at
before update on public.order_locations
for each row execute function public.set_updated_at();

alter table public.order_locations enable row level security;
alter table public.order_number_counters enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_outbox enable row level security;
alter table public.kitchen_sla_settings enable row level security;
alter table public.evotor_sync_cursors enable row level security;
alter table public.evotor_inbound_events enable row level security;

revoke all privileges on table public.order_locations from public;
revoke all privileges on table public.order_number_counters from public;
revoke all privileges on table public.order_status_events from public;
revoke all privileges on table public.order_outbox from public;
revoke all privileges on table public.kitchen_sla_settings from public;
revoke all privileges on table public.evotor_sync_cursors from public;
revoke all privileges on table public.evotor_inbound_events from public;
revoke all privileges on table public.canonical_analytics_sales from public;
revoke all on function public.next_order_sequence(uuid, text, date) from public;
revoke all on function public.populate_order_items_atomic(uuid, jsonb) from public;
revoke all on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz
) from public;
revoke all on function public.create_pos_order_atomic(uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.set_order_kitchen_status_atomic(uuid, text, uuid, text, text) from public;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    -- Keep the order RPCs independent from historical blanket grants. The
    -- server-only runtime role receives only the operations used by these
    -- transactions; browser roles remain denied by RLS.
    grant select on table
      public.products,
      public.product_ingredients,
      public.ingredients,
      public.customers,
      public.customer_avatars,
      public.site_settings,
      public.staff_users
    to karimoff_app;
    -- PostgreSQL row locks used for authoritative product prices and customer
    -- idempotency require UPDATE privilege even though these SELECTs do not
    -- mutate the locked rows.
    grant update on table public.products, public.customers to karimoff_app;
    grant select, insert, update on table public.orders to karimoff_app;
    grant select, insert on table
      public.order_items,
      public.order_item_modifiers,
      public.legal_consents,
      public.audit_logs,
      public.inventory_movements,
      public.order_inventory_deductions,
      public.loyalty_transactions
    to karimoff_app;
    grant select, insert, update on table
      public.order_item_ingredient_usage,
      public.inventory_items,
      public.loyalty_accounts
    to karimoff_app;
    grant select, insert, update on table
      public.order_locations,
      public.order_number_counters,
      public.order_status_events,
      public.order_outbox,
      public.kitchen_sla_settings,
      public.evotor_sync_cursors,
      public.evotor_inbound_events
    to karimoff_app;
    grant delete on table public.evotor_inbound_events to karimoff_app;
    grant usage, select on sequence public.order_outbox_id_seq to karimoff_app;
    grant select on table public.canonical_analytics_sales to karimoff_app;
    grant execute on function public.next_order_sequence(uuid, text, date) to karimoff_app;
    grant execute on function public.populate_order_items_atomic(uuid, jsonb) to karimoff_app;
    grant execute on function public.create_site_order(
      uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
      text, text, text, text, timestamptz
    ) to karimoff_app;
    grant execute on function public.create_pos_order_atomic(uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz) to karimoff_app;
    grant execute on function public.set_order_kitchen_status_atomic(uuid, text, uuid, text, text) to karimoff_app;
    grant execute on function public.get_order_inventory_requirements(uuid) to karimoff_app;
    grant execute on function public.set_order_status_staff_atomic(uuid, text, uuid, text, text) to karimoff_app;

    foreach v_table in array array[
      'order_locations', 'order_number_counters', 'order_status_events',
      'order_outbox', 'kitchen_sla_settings', 'evotor_sync_cursors',
      'evotor_inbound_events'
    ] loop
      execute format('drop policy if exists %I on public.%I', v_table || '_app_all', v_table);
      execute format(
        'create policy %I on public.%I for all to karimoff_app using (true) with check (true)',
        v_table || '_app_all', v_table
      );
    end loop;

    foreach v_table in array array[
      'products', 'product_ingredients', 'ingredients', 'customers',
      'customer_avatars', 'site_settings', 'staff_users', 'orders',
      'order_items', 'order_item_modifiers', 'order_item_ingredient_usage',
      'legal_consents', 'audit_logs', 'inventory_items',
      'inventory_movements', 'order_inventory_deductions',
      'loyalty_accounts', 'loyalty_transactions'
    ] loop
      execute format('drop policy if exists %I on public.%I', v_table || '_order_flow_app', v_table);
      execute format(
        'create policy %I on public.%I for all to karimoff_app using (true) with check (true)',
        v_table || '_order_flow_app', v_table
      );
    end loop;
  end if;
end
$$;
