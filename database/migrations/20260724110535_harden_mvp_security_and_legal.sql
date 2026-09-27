-- KARIMOFF MVP hardening: legal consent journal, revocable sessions,
-- server-authoritative orders, atomic inventory/loyalty updates, payments
-- scaffolding, audit logs, and restrictive Data API access.

create extension if not exists pgcrypto;

alter table public.products add column if not exists calories numeric;
alter table public.products add column if not exists protein numeric;
alter table public.products add column if not exists fat numeric;
alter table public.products add column if not exists carbs numeric;
alter table public.products add column if not exists allergens text[];

alter table public.orders add column if not exists updated_at timestamptz default now();
alter table public.orders add column if not exists idempotency_key uuid;
alter table public.orders add column if not exists payment_status text default 'not_required';
alter table public.orders add column if not exists fiscal_status text default 'not_required';

create unique index if not exists orders_idempotency_key_idx
  on public.orders (idempotency_key)
  where idempotency_key is not null;
create index if not exists orders_payment_status_idx on public.orders (payment_status);

alter table public.site_settings add column if not exists payments_enabled boolean default false;
alter table public.site_settings add column if not exists loyalty_redemption_limit_percent numeric;
alter table public.site_settings alter column loyalty_percent set default 10;
update public.site_settings
set loyalty_percent = 10, payments_enabled = false
where id = 'main' and loyalty_percent = 5;

alter table public.loyalty_transactions add column if not exists idempotency_key text;
create unique index if not exists loyalty_transactions_idempotency_key_idx
  on public.loyalty_transactions (idempotency_key)
  where idempotency_key is not null;

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  subject_type text not null,
  subject_id uuid,
  consent_type text not null,
  document_version text not null,
  granted boolean not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  source_path text not null,
  ip_hash text,
  user_agent_short text
);

create index if not exists legal_consents_subject_idx
  on public.legal_consents (subject_type, subject_id, created_at desc);
create index if not exists legal_consents_type_idx
  on public.legal_consents (consent_type, created_at desc);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  token_hash text not null unique,
  subject_type text not null,
  subject_id uuid,
  subject_ref_hash text,
  user_agent_short text
);

create index if not exists app_sessions_subject_idx
  on public.app_sessions (subject_type, subject_id, expires_at desc);
create index if not exists app_sessions_active_idx
  on public.app_sessions (expires_at)
  where revoked_at is null;

create table if not exists public.auth_rate_limits (
  bucket text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bucket, key_hash)
);

create index if not exists auth_rate_limits_locked_idx
  on public.auth_rate_limits (locked_until)
  where locked_until is not null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_type text not null default 'system',
  actor_id uuid,
  actor_ref_hash text,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  source_path text,
  user_agent_short text
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null,
  provider_payment_id text,
  idempotency_key text not null unique,
  status text not null default 'pending',
  amount numeric not null,
  currency text not null default 'RUB',
  confirmation_url text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists payments_provider_id_idx on public.payments (provider, provider_payment_id);
create index if not exists payments_status_idx on public.payments (status, created_at desc);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  payment_id uuid references public.payments(id) on delete set null,
  provider text not null,
  provider_event_id text,
  event_type text not null,
  signature_verified boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text
);

create unique index if not exists payment_events_provider_event_idx
  on public.payment_events (provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists payment_events_payment_idx on public.payment_events (payment_id, created_at desc);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider_refund_id text,
  idempotency_key text not null unique,
  status text not null default 'pending',
  amount numeric not null,
  reason text,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists refunds_order_idx on public.refunds (order_id, created_at desc);
create index if not exists refunds_payment_idx on public.refunds (payment_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_consents_subject_type_check'
      and conrelid = 'public.legal_consents'::regclass
  ) then
    alter table public.legal_consents
      add constraint legal_consents_subject_type_check
      check (subject_type in ('customer', 'lead', 'candidate', 'anonymous'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_consents_consent_type_check'
      and conrelid = 'public.legal_consents'::regclass
  ) then
    alter table public.legal_consents
      add constraint legal_consents_consent_type_check
      check (consent_type in (
        'personal_data', 'marketing', 'franchise', 'careers',
        'cookies_analytics', 'cookies_marketing', 'offer_acceptance',
        'loyalty_rules'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'app_sessions_subject_type_check'
      and conrelid = 'public.app_sessions'::regclass
  ) then
    alter table public.app_sessions
      add constraint app_sessions_subject_type_check
      check (subject_type in ('customer', 'admin'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_fiscal_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_fiscal_status_check
      check (fiscal_status in ('not_required', 'pending', 'issued', 'failed', 'refunded'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'site_settings_loyalty_redemption_limit_check'
      and conrelid = 'public.site_settings'::regclass
  ) then
    alter table public.site_settings
      add constraint site_settings_loyalty_redemption_limit_check
      check (
        loyalty_redemption_limit_percent is null
        or loyalty_redemption_limit_percent between 0 and 100
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_amount_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_amount_check check (amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'refunds_amount_check'
      and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds add constraint refunds_amount_check check (amount > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'products_price_nonnegative_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_price_nonnegative_check check (price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_total_nonnegative_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_total_nonnegative_check check (total >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_values_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_values_check
      check (quantity > 0 and unit_price >= 0 and line_total >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_ingredients_quantity_check'
      and conrelid = 'public.product_ingredients'::regclass
  ) then
    alter table public.product_ingredients
      add constraint product_ingredients_quantity_check check (quantity >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_nonnegative_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_nonnegative_check
      check (current_quantity >= 0 and reserved_quantity >= 0 and min_quantity >= 0) not valid;
  end if;
end
$$;

create or replace function public.auth_rate_limit_check(
  p_bucket text,
  p_key_hash text,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.auth_rate_limits%rowtype;
  v_now timestamptz := now();
begin
  select * into v_row
  from public.auth_rate_limits
  where bucket = p_bucket and key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer)
    );
  end if;

  if v_row.window_started_at < v_now - make_interval(secs => greatest(1, p_window_seconds)) then
    delete from public.auth_rate_limits
    where bucket = p_bucket and key_hash = p_key_hash;
  end if;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end
$$;

create or replace function public.auth_rate_limit_failure(
  p_bucket text,
  p_key_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_lock_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.auth_rate_limits%rowtype;
  v_now timestamptz := now();
  v_attempts integer;
begin
  insert into public.auth_rate_limits (
    bucket, key_hash, window_started_at, attempts, updated_at
  )
  values (p_bucket, p_key_hash, v_now, 1, v_now)
  on conflict (bucket, key_hash) do update
  set
    attempts = case
      when public.auth_rate_limits.window_started_at < v_now - make_interval(secs => greatest(1, p_window_seconds))
        then 1
      else public.auth_rate_limits.attempts + 1
    end,
    window_started_at = case
      when public.auth_rate_limits.window_started_at < v_now - make_interval(secs => greatest(1, p_window_seconds))
        then v_now
      else public.auth_rate_limits.window_started_at
    end,
    updated_at = v_now
  returning * into v_row;

  v_attempts := v_row.attempts;

  if v_attempts >= greatest(1, p_max_attempts) then
    update public.auth_rate_limits
    set locked_until = v_now + make_interval(secs => greatest(1, p_lock_seconds)),
        updated_at = v_now
    where bucket = p_bucket and key_hash = p_key_hash
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(v_row.locked_until <= v_now, true),
    'attempts', v_attempts,
    'retry_after_seconds', case
      when v_row.locked_until is null or v_row.locked_until <= v_now then 0
      else greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer)
    end
  );
end
$$;

create or replace function public.auth_rate_limit_clear(
  p_bucket text,
  p_key_hash text
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  delete from public.auth_rate_limits
  where bucket = p_bucket and key_hash = p_key_hash;
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
  p_user_agent_short text
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
  v_item_count integer;
  v_invalid_count integer;
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

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'Корзина пуста.';
  end if;

  with requested as (
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by product_id
  )
  select count(*), coalesce(sum(quantity), 0)
  into v_item_count, v_invalid_count
  from requested;

  if v_item_count = 0 or v_invalid_count <= 0 or v_invalid_count > 50 then
    raise exception using errcode = 'P0001', message = 'Проверьте количество товаров.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    where quantity < 1 or quantity > 20
  ) then
    raise exception using errcode = 'P0001', message = 'Количество одной позиции должно быть от 1 до 20.';
  end if;

  with requested as (
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by product_id
  )
  select count(*) into v_invalid_count
  from requested r
  left join public.products p on p.id = r.product_id and p.is_active = true
  where p.id is null;

  if v_invalid_count > 0 then
    raise exception using errcode = 'P0001', message = 'Один из товаров недоступен или удалён.';
  end if;

  perform 1
  from public.products p
  join (
    select product_id
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by product_id
  ) r on r.product_id = p.id
  order by p.id
  for share;

  with requested as (
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by product_id
  )
  select sum(p.price * r.quantity)
  into v_total
  from requested r
  join public.products p on p.id = r.product_id and p.is_active = true;

  if v_total is null or v_total < 0 then
    raise exception using errcode = 'P0001', message = 'Не удалось рассчитать сумму заказа.';
  end if;

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
    fiscal_status
  )
  values (
    v_customer.id,
    v_customer.name,
    v_customer.phone,
    p_delivery_type,
    case when p_delivery_type = 'delivery' then nullif(btrim(p_address), '') else null end,
    nullif(btrim(coalesce(p_comment, '')), ''),
    'new',
    v_total,
    'site',
    p_idempotency_key,
    'not_required',
    'not_required'
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, unit_price, quantity, line_total
  )
  select
    v_order_id,
    p.id,
    p.name,
    p.price,
    r.quantity,
    p.price * r.quantity
  from (
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by product_id
  ) r
  join public.products p on p.id = r.product_id and p.is_active = true;

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
    'customer', v_customer.id, 'order.create', 'order', v_order_id::text,
    jsonb_build_object('total', v_total, 'delivery_type', p_delivery_type),
    p_source_path, left(p_user_agent_short, 255)
  );

  return query select v_order_id, v_total;
end
$$;

create or replace function public.apply_inventory_movement_atomic(
  p_ingredient_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_new_quantity numeric,
  p_reason text,
  p_comment text,
  p_created_by text,
  p_package_price numeric default null,
  p_update_cost boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ingredient public.ingredients%rowtype;
  v_item public.inventory_items%rowtype;
  v_delta numeric;
  v_next numeric;
begin
  if p_movement_type not in ('receipt', 'write_off', 'correction', 'return') then
    raise exception using errcode = 'P0001', message = 'Некорректный тип движения.';
  end if;

  select * into v_ingredient
  from public.ingredients
  where id = p_ingredient_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Ингредиент не найден.';
  end if;

  insert into public.inventory_items (ingredient_id, current_quantity, unit)
  values (p_ingredient_id, 0, v_ingredient.unit)
  on conflict (ingredient_id) do nothing;

  select * into v_item
  from public.inventory_items
  where ingredient_id = p_ingredient_id
  for update;

  if p_movement_type = 'correction' then
    if p_new_quantity is null or p_new_quantity < 0 then
      raise exception using errcode = 'P0001', message = 'Остаток не может быть отрицательным.';
    end if;
    v_delta := p_new_quantity - v_item.current_quantity;
    v_next := p_new_quantity;
  elsif p_movement_type in ('receipt', 'return') then
    if p_quantity is null or p_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'Количество должно быть больше нуля.';
    end if;
    v_delta := p_quantity;
    v_next := v_item.current_quantity + p_quantity;
  else
    if p_quantity is null or p_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'Количество должно быть больше нуля.';
    end if;
    if v_item.current_quantity < p_quantity then
      raise exception using errcode = 'P0001', message = 'Недостаточно остатка для списания.';
    end if;
    v_delta := -p_quantity;
    v_next := v_item.current_quantity - p_quantity;
  end if;

  update public.inventory_items
  set current_quantity = v_next, unit = v_ingredient.unit, updated_at = now()
  where id = v_item.id;

  if p_update_cost and p_package_price is not null and p_quantity is not null and p_quantity > 0 then
    update public.ingredients
    set cost_per_unit = p_package_price / p_quantity, updated_at = now()
    where id = p_ingredient_id;
  end if;

  insert into public.inventory_movements (
    ingredient_id, movement_type, quantity, unit, reason, comment, created_by
  )
  values (
    p_ingredient_id, p_movement_type, v_delta, v_ingredient.unit,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_comment, '')), ''),
    coalesce(nullif(btrim(p_created_by), ''), 'system')
  );

  insert into public.audit_logs (
    actor_type, action, entity_type, entity_id, metadata
  )
  values (
    case when p_created_by = 'admin' then 'admin' else 'system' end,
    'inventory.' || p_movement_type,
    'ingredient',
    p_ingredient_id::text,
    jsonb_build_object('delta', v_delta, 'new_quantity', v_next, 'unit', v_ingredient.unit)
  );

  return jsonb_build_object('ok', true, 'new_quantity', v_next, 'delta', v_delta);
end
$$;

create or replace function public.set_order_status_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_ref_hash text default null,
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

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ не найден.';
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
      and (
        oi.product_id is null
        or not exists (
          select 1 from public.product_ingredients pi
          where pi.product_id = oi.product_id
        )
      );

    if not v_inventory_already_deducted then
      perform 1
      from public.inventory_items ii
      where ii.ingredient_id in (
        select pi.ingredient_id
        from public.order_items oi
        join public.product_ingredients pi on pi.product_id = oi.product_id
        where oi.order_id = p_order_id
      )
      order by ii.ingredient_id
      for update;

      with required as (
        select
          pi.ingredient_id,
          sum(pi.quantity * oi.quantity)::numeric as required_quantity
        from public.order_items oi
        join public.product_ingredients pi on pi.product_id = oi.product_id
        where oi.order_id = p_order_id
        group by pi.ingredient_id
      ),
      deficits as (
        select
          i.name,
          r.required_quantity,
          coalesce(ii.current_quantity, 0) as available_quantity,
          i.unit
        from required r
        join public.ingredients i on i.id = r.ingredient_id
        left join public.inventory_items ii on ii.ingredient_id = r.ingredient_id
        where coalesce(ii.current_quantity, 0) < r.required_quantity
      )
      select string_agg(
        format(
          '%s: нужно %s %s, доступно %s %s',
          name, required_quantity, unit, available_quantity, unit
        ),
        '; '
      )
      into v_deficits
      from deficits;

      if v_deficits is not null then
        raise exception using
          errcode = 'P0001',
          message = 'Недостаточно остатков: ' || v_deficits;
      end if;

      with required as (
        select
          pi.ingredient_id,
          sum(pi.quantity * oi.quantity)::numeric as required_quantity
        from public.order_items oi
        join public.product_ingredients pi on pi.product_id = oi.product_id
        where oi.order_id = p_order_id
        group by pi.ingredient_id
      )
      update public.inventory_items ii
      set current_quantity = ii.current_quantity - r.required_quantity,
          updated_at = now()
      from required r
      where ii.ingredient_id = r.ingredient_id;

      insert into public.inventory_movements (
        ingredient_id, order_id, product_id, movement_type, quantity, unit,
        reason, comment, created_by
      )
      select
        pi.ingredient_id,
        p_order_id,
        oi.product_id,
        'sale',
        -(pi.quantity * oi.quantity),
        i.unit,
        'Автосписание по заказу',
        'Автосписание: ' || oi.product_name,
        'system'
      from public.order_items oi
      join public.product_ingredients pi on pi.product_id = oi.product_id
      join public.ingredients i on i.id = pi.ingredient_id
      where oi.order_id = p_order_id;

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
          customer_id, order_id, type, points, description, idempotency_key
        )
        values (
          v_order.customer_id, p_order_id, 'earn', v_points,
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
  elsif p_status = 'cancelled' and v_order.status = 'completed' and v_order.customer_id is not null then
    select coalesce(sum(points), 0)
    into v_reverse_points
    from public.loyalty_transactions
    where order_id = p_order_id and type = 'earn';

    if v_reverse_points > 0 then
      insert into public.loyalty_transactions (
        customer_id, order_id, type, points, description, idempotency_key
      )
      values (
        v_order.customer_id, p_order_id, 'adjust', -v_reverse_points,
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
  set status = p_status, updated_at = now()
  where id = p_order_id;

  insert into public.audit_logs (
    actor_type, actor_ref_hash, action, entity_type, entity_id, metadata, source_path
  )
  values (
    'admin', p_actor_ref_hash, 'order.status_change', 'order', p_order_id::text,
    jsonb_build_object('from', v_order.status, 'to', p_status, 'warnings', v_warnings),
    p_source_path
  );

  return jsonb_build_object('ok', true, 'warnings', v_warnings);
end
$$;

-- Lock down the Data API. Public pages in this application read through the
-- server-side service-role client; only explicitly safe catalogue data remains
-- directly readable by anon/authenticated.
do $$
declare
  v_table text;
begin
  for v_table in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all privileges on table public.%I from anon, authenticated', v_table);
    execute format('grant all privileges on table public.%I to service_role', v_table);
  end loop;
end
$$;

drop policy if exists products_public_read on public.products;
create policy products_public_read
on public.products for select
to anon, authenticated
using (is_active = true);
grant select on public.products to anon, authenticated;

drop policy if exists product_images_public_read on public.product_images;
create policy product_images_public_read
on public.product_images for select
to anon, authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = product_images.product_id and p.is_active = true
  )
);
grant select on public.product_images to anon, authenticated;

drop policy if exists vacancies_public_read on public.vacancies;
create policy vacancies_public_read
on public.vacancies for select
to anon, authenticated
using (is_active = true);
grant select on public.vacancies to anon, authenticated;

drop policy if exists avatar_assets_public_read on public.avatar_assets;
create policy avatar_assets_public_read
on public.avatar_assets for select
to anon, authenticated
using (is_active = true);
grant select on public.avatar_assets to anon, authenticated;

drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read
on public.site_settings for select
to anon, authenticated
using (id = 'main');
grant select on public.site_settings to anon, authenticated;

revoke all on function public.auth_rate_limit_check(text, text, integer) from public, anon, authenticated;
revoke all on function public.auth_rate_limit_failure(text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.auth_rate_limit_clear(text, text) from public, anon, authenticated;
revoke all on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, text, text, text
) from public, anon, authenticated;
revoke all on function public.apply_inventory_movement_atomic(
  uuid, text, numeric, numeric, text, text, text, numeric, boolean
) from public, anon, authenticated;
revoke all on function public.set_order_status_atomic(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.auth_rate_limit_check(text, text, integer) to service_role;
grant execute on function public.auth_rate_limit_failure(text, text, integer, integer, integer) to service_role;
grant execute on function public.auth_rate_limit_clear(text, text) to service_role;
grant execute on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, text, text, text
) to service_role;
grant execute on function public.apply_inventory_movement_atomic(
  uuid, text, numeric, numeric, text, text, text, numeric, boolean
) to service_role;
grant execute on function public.set_order_status_atomic(uuid, text, text, text)
  to service_role;
