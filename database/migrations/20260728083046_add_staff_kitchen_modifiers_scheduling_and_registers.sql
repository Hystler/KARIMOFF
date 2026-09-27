-- Staff roles, kitchen workflow, scheduled fulfillment, product modifiers,
-- inventory snapshots and provider-neutral cash register architecture.

create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  phone text not null unique,
  password_hash text not null,
  role text not null default 'cook',
  is_active boolean not null default true,
  last_login_at timestamptz
);

create index if not exists staff_users_role_active_idx
  on public.staff_users (role, is_active);
create index if not exists staff_users_phone_idx
  on public.staff_users (phone);

alter table public.product_ingredients
  add column if not exists is_removable boolean not null default false;
alter table public.product_ingredients
  add column if not exists is_extra_available boolean not null default false;
alter table public.product_ingredients
  add column if not exists extra_quantity numeric not null default 0;
alter table public.product_ingredients
  add column if not exists extra_price numeric not null default 0;
alter table public.product_ingredients
  add column if not exists max_extra_quantity integer not null default 1;

alter table public.order_items
  add column if not exists inventory_snapshot_ready boolean not null default false;

alter table public.orders
  add column if not exists fulfillment_mode text not null default 'asap';
alter table public.orders
  add column if not exists requested_at timestamptz;
alter table public.orders
  add column if not exists kitchen_started_at timestamptz;
alter table public.orders
  add column if not exists kitchen_completed_at timestamptz;
alter table public.orders
  add column if not exists assigned_staff_id uuid;

create index if not exists orders_requested_at_idx
  on public.orders (requested_at)
  where status in ('new', 'in_progress');
create index if not exists orders_kitchen_queue_idx
  on public.orders (status, requested_at, created_at);
create index if not exists orders_assigned_staff_idx
  on public.orders (assigned_staff_id);

create table if not exists public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  modifier_type text not null,
  ingredient_name text not null,
  quantity numeric not null default 0,
  unit text not null default 'g',
  unit_price_delta numeric not null default 0,
  line_price_delta numeric not null default 0
);

create index if not exists order_item_modifiers_item_idx
  on public.order_item_modifiers (order_item_id, created_at);
create index if not exists order_item_modifiers_ingredient_idx
  on public.order_item_modifiers (ingredient_id);

create table if not exists public.order_item_ingredient_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  ingredient_name text not null,
  quantity_per_item numeric not null default 0,
  unit text not null default 'g',
  unique (order_item_id, ingredient_id)
);

create index if not exists order_item_usage_item_idx
  on public.order_item_ingredient_usage (order_item_id);
create index if not exists order_item_usage_ingredient_idx
  on public.order_item_ingredient_usage (ingredient_id);

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  provider text not null default 'manual',
  location text,
  external_register_id text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

create index if not exists cash_registers_active_idx
  on public.cash_registers (is_active, name);

alter table public.orders
  add column if not exists cash_register_id uuid references public.cash_registers(id) on delete set null;
create index if not exists orders_cash_register_idx
  on public.orders (cash_register_id);

create table if not exists public.fiscal_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete set null,
  cash_register_id uuid references public.cash_registers(id) on delete set null,
  receipt_type text not null default 'sale',
  status text not null default 'pending',
  provider_receipt_id text,
  idempotency_key text not null unique,
  amount numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  fiscalized_at timestamptz
);

create index if not exists fiscal_receipts_order_idx
  on public.fiscal_receipts (order_id, created_at desc);
create index if not exists fiscal_receipts_status_idx
  on public.fiscal_receipts (status, created_at desc);

create table if not exists public.cash_register_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cash_register_id uuid references public.cash_registers(id) on delete set null,
  receipt_id uuid references public.fiscal_receipts(id) on delete set null,
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text
);

create unique index if not exists cash_register_events_provider_event_idx
  on public.cash_register_events (provider_event_id)
  where provider_event_id is not null;
create index if not exists cash_register_events_receipt_idx
  on public.cash_register_events (receipt_id, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'app_sessions_subject_type_check'
      and conrelid = 'public.app_sessions'::regclass
  ) then
    alter table public.app_sessions drop constraint app_sessions_subject_type_check;
  end if;

  alter table public.app_sessions
    add constraint app_sessions_subject_type_check
    check (subject_type in ('customer', 'admin', 'staff'));

  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_users_role_check'
      and conrelid = 'public.staff_users'::regclass
  ) then
    alter table public.staff_users
      add constraint staff_users_role_check
      check (role in ('admin', 'manager', 'cook'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_assigned_staff_fk'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_assigned_staff_fk
      foreign key (assigned_staff_id) references public.staff_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_fulfillment_mode_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_fulfillment_mode_check
      check (fulfillment_mode in ('asap', 'scheduled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_ingredients_modifier_values_check'
      and conrelid = 'public.product_ingredients'::regclass
  ) then
    alter table public.product_ingredients
      add constraint product_ingredients_modifier_values_check
      check (
        extra_quantity >= 0
        and extra_price >= 0
        and max_extra_quantity between 1 and 10
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_type_check'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers
      add constraint order_item_modifiers_type_check
      check (modifier_type in ('remove', 'add'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_values_check'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers
      add constraint order_item_modifiers_values_check
      check (
        quantity >= 0
        and unit_price_delta >= 0
        and line_price_delta >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_usage_quantity_check'
      and conrelid = 'public.order_item_ingredient_usage'::regclass
  ) then
    alter table public.order_item_ingredient_usage
      add constraint order_item_usage_quantity_check
      check (quantity_per_item >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cash_registers_provider_check'
      and conrelid = 'public.cash_registers'::regclass
  ) then
    alter table public.cash_registers
      add constraint cash_registers_provider_check
      check (provider in ('manual', 'evotor', 'atol', 'cloud_kassa', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_type_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts
      add constraint fiscal_receipts_type_check
      check (receipt_type in ('sale', 'refund', 'correction'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_status_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts
      add constraint fiscal_receipts_status_check
      check (status in ('pending', 'processing', 'issued', 'failed', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_amount_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts
      add constraint fiscal_receipts_amount_check
      check (amount >= 0);
  end if;
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
  v_order_item_id uuid;
  v_product public.products%rowtype;
  v_item jsonb;
  v_removed jsonb;
  v_extras jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_total numeric := 0;
  v_line_unit_price numeric;
  v_extra_total numeric;
  v_total_quantity integer := 0;
  v_has_composition boolean;
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

  if p_fulfillment_mode = 'scheduled' then
    if p_requested_at is null then
      raise exception using errcode = 'P0001', message = 'Выберите время получения.';
    end if;

    if p_requested_at < now() + interval '15 minutes' then
      raise exception using errcode = 'P0001', message = 'Время заказа должно быть минимум через 15 минут.';
    end if;

    if p_requested_at > now() + interval '7 days' then
      raise exception using errcode = 'P0001', message = 'Заказ можно запланировать не более чем на 7 дней вперёд.';
    end if;
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
    where idempotency_key = p_idempotency_key;

    if found then
      if v_existing.customer_id <> p_customer_id then
        raise exception using errcode = 'P0001', message = 'Некорректный ключ повторного запроса.';
      end if;
      return query select v_existing.id, v_existing.total;
      return;
    end if;
  end if;

  if jsonb_typeof(p_items) <> 'array'
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
      raise exception using errcode = 'P0001', message = 'Некорректная позиция корзины.';
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
  end loop;

  insert into public.orders (
    customer_id,
    customer_name,
    customer_phone,
    delivery_type,
    address,
    comment,
    status,
    total,
    source,
    idempotency_key,
    payment_status,
    fiscal_status,
    fulfillment_mode,
    requested_at
  )
  values (
    v_customer.id,
    v_customer.name,
    v_customer.phone,
    p_delivery_type,
    case when p_delivery_type = 'delivery' then nullif(btrim(p_address), '') else null end,
    nullif(btrim(coalesce(p_comment, '')), ''),
    'new',
    0,
    'site',
    p_idempotency_key,
    'not_required',
    'not_required',
    p_fulfillment_mode,
    case when p_fulfillment_mode = 'scheduled' then p_requested_at else null end
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_removed := coalesce(v_item->'removed_ingredient_ids', '[]'::jsonb);
    v_extras := coalesce(v_item->'extras', '[]'::jsonb);

    select * into v_product
    from public.products
    where id = v_product_id and is_active = true;

    select exists (
      select 1 from public.product_ingredients pi
      where pi.product_id = v_product_id and pi.quantity > 0
    )
    into v_has_composition;

    select coalesce(sum(pi.extra_price * x.quantity), 0)
    into v_extra_total
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true;

    v_line_unit_price := v_product.price + v_extra_total;

    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      line_total,
      inventory_snapshot_ready
    )
    values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_line_unit_price,
      v_quantity,
      v_line_unit_price * v_quantity,
      v_has_composition
    )
    returning id into v_order_item_id;

    insert into public.order_item_modifiers (
      order_item_id,
      ingredient_id,
      modifier_type,
      ingredient_name,
      quantity,
      unit,
      unit_price_delta,
      line_price_delta
    )
    select
      v_order_item_id,
      pi.ingredient_id,
      'remove',
      i.name,
      pi.quantity,
      pi.unit,
      0,
      0
    from jsonb_array_elements_text(v_removed) x(ingredient_id)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id::uuid
     and pi.is_removable = true
    join public.ingredients i on i.id = pi.ingredient_id;

    insert into public.order_item_modifiers (
      order_item_id,
      ingredient_id,
      modifier_type,
      ingredient_name,
      quantity,
      unit,
      unit_price_delta,
      line_price_delta
    )
    select
      v_order_item_id,
      pi.ingredient_id,
      'add',
      i.name,
      pi.extra_quantity * sum(x.quantity),
      pi.unit,
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
      order_item_id,
      ingredient_id,
      ingredient_name,
      quantity_per_item,
      unit
    )
    select
      v_order_item_id,
      pi.ingredient_id,
      i.name,
      pi.quantity,
      pi.unit
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
      order_item_id,
      ingredient_id,
      ingredient_name,
      quantity_per_item,
      unit
    )
    select
      v_order_item_id,
      pi.ingredient_id,
      i.name,
      pi.extra_quantity * sum(x.quantity),
      pi.unit
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true
    join public.ingredients i on i.id = pi.ingredient_id
    group by pi.ingredient_id, i.name, pi.extra_quantity, pi.unit
    on conflict (order_item_id, ingredient_id)
    do update set
      quantity_per_item =
        public.order_item_ingredient_usage.quantity_per_item
        + excluded.quantity_per_item;

    v_total := v_total + v_line_unit_price * v_quantity;
  end loop;

  update public.orders
  set total = v_total, updated_at = now()
  where id = v_order_id;

  insert into public.legal_consents (
    subject_type, subject_id, consent_type, document_version, granted,
    granted_at, revoked_at, source_path, user_agent_short
  )
  values
    ('customer', v_customer.id, 'personal_data', p_document_version, true, now(), null, p_source_path, left(p_user_agent_short, 255)),
    ('customer', v_customer.id, 'offer_acceptance', p_document_version, true, now(), null, p_source_path, left(p_user_agent_short, 255)),
    (
      'customer', v_customer.id, 'marketing', p_document_version, p_marketing_granted,
      case when p_marketing_granted then now() else null end,
      case when p_marketing_granted then null else now() end,
      p_source_path, left(p_user_agent_short, 255)
    );

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, metadata, source_path, user_agent_short
  )
  values (
    'customer',
    v_customer.id,
    'order.create',
    'order',
    v_order_id::text,
    jsonb_build_object(
      'total', v_total,
      'delivery_type', p_delivery_type,
      'fulfillment_mode', p_fulfillment_mode,
      'requested_at', p_requested_at
    ),
    p_source_path,
    left(p_user_agent_short, 255)
  );

  return query select v_order_id, v_total;
end
$$;

create or replace function public.get_order_inventory_requirements(p_order_id uuid)
returns table(ingredient_id uuid, required_quantity numeric, unit text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with effective_usage as (
    select
      usage.ingredient_id,
      usage.quantity_per_item,
      usage.unit,
      oi.quantity
    from public.order_items oi
    join public.order_item_ingredient_usage usage
      on usage.order_item_id = oi.id
    where oi.order_id = p_order_id
      and oi.inventory_snapshot_ready = true

    union all

    select
      pi.ingredient_id,
      pi.quantity,
      pi.unit,
      oi.quantity
    from public.order_items oi
    join public.product_ingredients pi
      on pi.product_id = oi.product_id
    where oi.order_id = p_order_id
      and oi.inventory_snapshot_ready = false
      and pi.quantity > 0
  )
  select
    effective_usage.ingredient_id,
    sum(effective_usage.quantity_per_item * effective_usage.quantity)::numeric,
    max(effective_usage.unit)
  from effective_usage
  group by effective_usage.ingredient_id
$$;

create or replace function public.set_order_status_staff_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid default null,
  p_actor_role text default 'admin',
  p_source_path text default '/admin/orders'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_warnings jsonb := '[]'::jsonb;
  v_deficits text;
  v_points numeric;
  v_loyalty_percent numeric;
  v_loyalty_enabled boolean;
  v_loyalty_joined boolean;
  v_earned_inserted integer := 0;
  v_reverse_points numeric;
  v_inventory_already_deducted boolean := false;
begin
  if p_status not in ('new', 'in_progress', 'completed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус заказа.';
  end if;

  if p_actor_role not in ('admin', 'manager', 'cook') then
    raise exception using errcode = 'P0001', message = 'Некорректная роль сотрудника.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ не найден.';
  end if;

  if p_actor_role = 'cook'
    and not (
      (v_order.status = 'new' and p_status = 'in_progress')
      or (v_order.status = 'in_progress' and p_status = 'completed')
      or v_order.status = p_status
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'Повар может только принять новый заказ в работу или отметить готовящуюся позицию выполненной.';
  end if;

  if v_order.status = p_status then
    return jsonb_build_object('ok', true, 'already_applied', true, 'warnings', v_warnings);
  end if;

  if p_status = 'completed' then
    select exists (
      select 1
      from public.order_inventory_deductions oid
      where oid.order_id = p_order_id
    )
    into v_inventory_already_deducted;

    if v_order.status = 'cancelled' and v_inventory_already_deducted then
      raise exception using
        errcode = 'P0001',
        message = 'Нельзя повторно завершить отменённый заказ, по которому уже был списан склад.';
    end if;

    select coalesce(
      jsonb_agg(format('У товара не задан состав, склад не списан: %s', oi.product_name)),
      '[]'::jsonb
    )
    into v_warnings
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.inventory_snapshot_ready = false
      and (
        oi.product_id is null
        or not exists (
          select 1
          from public.product_ingredients pi
          where pi.product_id = oi.product_id and pi.quantity > 0
        )
      );

    if not v_inventory_already_deducted then
      perform 1
      from public.inventory_items ii
      where ii.ingredient_id in (
        select requirements.ingredient_id
        from public.get_order_inventory_requirements(p_order_id) requirements
      )
      order by ii.ingredient_id
      for update;

      select string_agg(
        format(
          '%s: нужно %s %s, доступно %s %s',
          i.name,
          requirements.required_quantity,
          requirements.unit,
          coalesce(ii.current_quantity, 0),
          requirements.unit
        ),
        '; '
      )
      into v_deficits
      from public.get_order_inventory_requirements(p_order_id) requirements
      join public.ingredients i on i.id = requirements.ingredient_id
      left join public.inventory_items ii on ii.ingredient_id = requirements.ingredient_id
      where coalesce(ii.current_quantity, 0) < requirements.required_quantity;

      if v_deficits is not null then
        raise exception using
          errcode = 'P0001',
          message = 'Недостаточно остатков: ' || v_deficits;
      end if;

      update public.inventory_items ii
      set current_quantity = ii.current_quantity - requirements.required_quantity,
          updated_at = now()
      from public.get_order_inventory_requirements(p_order_id) requirements
      where ii.ingredient_id = requirements.ingredient_id;

      insert into public.inventory_movements (
        ingredient_id,
        order_id,
        product_id,
        movement_type,
        quantity,
        unit,
        reason,
        comment,
        created_by
      )
      select
        requirements.ingredient_id,
        p_order_id,
        null,
        'sale',
        -requirements.required_quantity,
        requirements.unit,
        'Автосписание по заказу',
        'Фактический состав заказа с учётом модификаций',
        'system'
      from public.get_order_inventory_requirements(p_order_id) requirements;

      insert into public.order_inventory_deductions (order_id, status)
      values (p_order_id, 'deducted');
    else
      v_warnings := v_warnings || jsonb_build_array(
        'Склад по этому заказу уже был списан повторно и не изменён.'
      );
    end if;

    select loyalty_enabled, loyalty_percent
    into v_loyalty_enabled, v_loyalty_percent
    from public.site_settings
    where id = 'main';

    select coalesce((
      select lc.granted
      from public.legal_consents lc
      where lc.subject_type = 'customer'
        and lc.subject_id = v_order.customer_id
        and lc.consent_type = 'loyalty_rules'
      order by lc.created_at desc
      limit 1
    ), false)
    into v_loyalty_joined;

    if coalesce(v_loyalty_enabled, true)
      and v_loyalty_joined
      and v_order.customer_id is not null
      and v_order.payment_status in ('paid', 'not_required')
    then
      v_points := round(greatest(0, v_order.total) * coalesce(v_loyalty_percent, 10) / 100, 2);

      if v_points > 0 then
        insert into public.loyalty_accounts (customer_id)
        values (v_order.customer_id)
        on conflict (customer_id) do nothing;

        insert into public.loyalty_transactions (
          customer_id,
          order_id,
          type,
          points,
          description,
          idempotency_key
        )
        values (
          v_order.customer_id,
          p_order_id,
          'earn',
          v_points,
          'Начисление за выполненный заказ ' || p_order_id,
          'order:' || p_order_id || ':earn'
        )
        on conflict (idempotency_key) do nothing;

        get diagnostics v_earned_inserted = row_count;

        if v_earned_inserted = 1 then
          update public.loyalty_accounts
          set points_balance = points_balance + v_points,
              total_earned = total_earned + v_points,
              updated_at = now()
          where customer_id = v_order.customer_id;
        end if;
      end if;
    end if;
  elsif p_status = 'cancelled'
    and v_order.status = 'completed'
    and v_order.customer_id is not null
  then
    select coalesce(sum(points), 0)
    into v_reverse_points
    from public.loyalty_transactions
    where order_id = p_order_id and type = 'earn';

    if v_reverse_points > 0 then
      insert into public.loyalty_transactions (
        customer_id,
        order_id,
        type,
        points,
        description,
        idempotency_key
      )
      values (
        v_order.customer_id,
        p_order_id,
        'adjust',
        -v_reverse_points,
        'Корректировка бонусов при отмене/возврате заказа ' || p_order_id,
        'order:' || p_order_id || ':reverse'
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_earned_inserted = row_count;

      if v_earned_inserted = 1 then
        update public.loyalty_accounts
        set points_balance = points_balance - v_reverse_points,
            total_spent = total_spent + v_reverse_points,
            updated_at = now()
        where customer_id = v_order.customer_id;
      end if;
    end if;

    v_warnings := v_warnings || jsonb_build_array(
      'Автоматический возврат ингредиентов на склад пока не выполняется; при необходимости оформите движение «Возврат».'
    );
  end if;

  update public.orders
  set
    status = p_status,
    updated_at = now(),
    assigned_staff_id = case
      when p_actor_id is not null and p_status in ('in_progress', 'completed')
        then coalesce(assigned_staff_id, p_actor_id)
      else assigned_staff_id
    end,
    kitchen_started_at = case
      when p_status = 'in_progress' then coalesce(kitchen_started_at, now())
      else kitchen_started_at
    end,
    kitchen_completed_at = case
      when p_status = 'completed' then coalesce(kitchen_completed_at, now())
      else kitchen_completed_at
    end
  where id = p_order_id;

  insert into public.audit_logs (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    source_path
  )
  values (
    'staff',
    p_actor_id,
    'order.status_change',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'from', v_order.status,
      'to', p_status,
      'role', p_actor_role,
      'warnings', v_warnings
    ),
    p_source_path
  );

  return jsonb_build_object('ok', true, 'warnings', v_warnings);
end
$$;

alter table public.staff_users enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_item_ingredient_usage enable row level security;
alter table public.cash_registers enable row level security;
alter table public.fiscal_receipts enable row level security;
alter table public.cash_register_events enable row level security;

revoke all privileges on table public.staff_users from anon, authenticated;
revoke all privileges on table public.order_item_modifiers from anon, authenticated;
revoke all privileges on table public.order_item_ingredient_usage from anon, authenticated;
revoke all privileges on table public.cash_registers from anon, authenticated;
revoke all privileges on table public.fiscal_receipts from anon, authenticated;
revoke all privileges on table public.cash_register_events from anon, authenticated;

grant all privileges on table public.staff_users to service_role;
grant all privileges on table public.order_item_modifiers to service_role;
grant all privileges on table public.order_item_ingredient_usage to service_role;
grant all privileges on table public.cash_registers to service_role;
grant all privileges on table public.fiscal_receipts to service_role;
grant all privileges on table public.cash_register_events to service_role;

revoke all on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_order_inventory_requirements(uuid)
  from public, anon, authenticated;
revoke all on function public.set_order_status_staff_atomic(uuid, text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz
) to service_role;
grant execute on function public.get_order_inventory_requirements(uuid)
  to service_role;
grant execute on function public.set_order_status_staff_atomic(uuid, text, uuid, text, text)
  to service_role;
