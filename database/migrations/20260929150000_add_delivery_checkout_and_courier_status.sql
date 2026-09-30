-- Delivery pricing is authoritative in the payment transaction. Coverage stays
-- closed until a verified address polygon/geocoder is configured.
alter table public.site_settings
  add column if not exists delivery_coverage_enabled boolean not null default false;

alter table public.orders
  add column if not exists delivery_fee numeric not null default 0,
  add column if not exists courier_handed_at timestamptz;

alter table public.orders drop constraint if exists orders_delivery_fee_nonnegative_check;
alter table public.orders add constraint orders_delivery_fee_nonnegative_check
  check (delivery_fee >= 0) not valid;

alter table public.order_items
  add column if not exists item_type text not null default 'food';

alter table public.order_items drop constraint if exists order_items_item_type_check;
alter table public.order_items add constraint order_items_item_type_check
  check (item_type in ('food', 'delivery_fee')) not valid;

alter table public.orders drop constraint if exists orders_kitchen_status_check;
alter table public.orders add constraint orders_kitchen_status_check
  check (kitchen_status in (
    'new', 'accepted', 'cooking', 'ready', 'handed_to_courier', 'handed_out', 'cancelled'
  )) not valid;

create or replace function public.build_yookassa_order_receipt_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_agg(
    jsonb_build_object(
      'order_item_id', item.id::text,
      'product_name', item.product_name,
      'quantity', item.quantity::text,
      'unit_price', item.unit_price::text,
      'line_total', item.line_total::text,
      'payment_subject', case when item.item_type = 'delivery_fee' then 'service' else 'commodity' end,
      'modifiers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'modifier_type', modifier.modifier_type,
            'ingredient_name', modifier.ingredient_name
          ) order by modifier.created_at, modifier.id
        )
        from public.order_item_modifiers modifier
        where modifier.order_item_id = item.id
      ), '[]'::jsonb)
    ) order by item.id
  )
  from public.order_items item
  where item.order_id = p_order_id
$$;

create or replace function public.initialize_order_item_kitchen_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.order_item_kitchen_state (order_item_id, station, status, ready_at)
  values (
    new.id,
    case when new.item_type = 'delivery_fee' then coalesce((
      select work.station
      from public.order_items food
      join public.order_item_kitchen_state work on work.order_item_id = food.id
      where food.order_id = new.order_id and food.item_type = 'food'
      order by food.id
      limit 1
    ), 'snacks')
      else public.kitchen_station_for_category((select category from public.products where id = new.product_id)) end,
    case when new.item_type = 'delivery_fee' then 'ready' else 'new' end,
    case when new.item_type = 'delivery_fee' then now() else null end
  )
  on conflict (order_item_id) do nothing;
  return new;
end
$$;

create or replace function public.create_site_order_with_payment(
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
  p_requested_at timestamptz,
  p_receipt_email text,
  p_payment_idempotency_key text
)
returns table(
  order_id uuid,
  total numeric,
  display_number text,
  payment_id uuid,
  payment_idempotency_key text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order_result record;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_email text := lower(btrim(coalesce(p_receipt_email, '')));
  v_subtotal numeric := 0;
  v_expected_delivery_fee numeric := 0;
  v_recorded_delivery_fee numeric := 0;
begin
  if p_delivery_type = 'delivery' and not coalesce((
    select settings.delivery_coverage_enabled
    from public.site_settings settings
    where settings.id = 'main'
  ), false) then
    raise exception using errcode = 'P0001', message = 'Доставка временно недоступна: проверка зоны обслуживания ещё не настроена.';
  end if;

  if v_email = '' or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = 'P0001', message = 'Укажите корректную электронную почту для чека.';
  end if;
  if p_payment_idempotency_key is null
    or length(p_payment_idempotency_key) > 64
    or p_payment_idempotency_key !~ '^[0-9A-Za-z+_.-]+$'
  then
    raise exception using errcode = 'P0001', message = 'Некорректный ключ платежной операции.';
  end if;

  select * into v_order_result
  from public.create_site_order(
    p_customer_id,
    p_delivery_type,
    p_address,
    p_comment,
    p_items,
    p_idempotency_key,
    p_personal_data_granted,
    p_offer_accepted,
    p_marketing_granted,
    p_document_version,
    p_source_path,
    p_user_agent_short,
    p_fulfillment_mode,
    p_requested_at,
    false
  );

  select * into v_order
  from public.orders
  where id = v_order_result.order_id
  for update;

  if v_order.customer_id <> p_customer_id or v_order.source <> 'web' or v_order.is_test then
    raise exception using errcode = 'P0001', message = 'Некорректный заказ для онлайн-оплаты.';
  end if;

  select * into v_payment
  from public.payments
  where idempotency_key = p_payment_idempotency_key
  for update;

  if found then
    if v_payment.order_id <> v_order.id
      or v_payment.provider <> 'yookassa'
      or v_payment.amount <> v_order.total
      or v_payment.currency <> 'RUB'
      or v_payment.receipt_email <> v_email
    then
      raise exception using errcode = 'P0001', message = 'Ключ платежа уже использован для другой операции.';
    end if;
  else
    select
      coalesce(sum(item.line_total) filter (where item.item_type = 'food'), 0),
      coalesce(sum(item.line_total) filter (where item.item_type = 'delivery_fee'), 0)
    into v_subtotal, v_recorded_delivery_fee
    from public.order_items item
    where item.order_id = v_order.id;

    v_expected_delivery_fee := case
      when v_order.delivery_type = 'delivery' and v_subtotal < 2500 then 200
      else 0
    end;

    if v_recorded_delivery_fee = 0 and v_order.delivery_fee = 0 then
      if v_order.total <> v_subtotal then
        raise exception using errcode = 'P0001', message = 'Сумма позиций заказа не совпадает с итогом.';
      end if;
      if v_expected_delivery_fee > 0 then
        update public.orders
        set total = v_subtotal + v_expected_delivery_fee,
            delivery_fee = v_expected_delivery_fee,
            updated_at = now()
        where id = v_order.id;
        insert into public.order_items (
          order_id, product_id, product_name, unit_price, quantity, line_total, item_type
        ) values (
          v_order.id, null, 'Доставка', v_expected_delivery_fee, 1, v_expected_delivery_fee, 'delivery_fee'
        );
        v_order.total := v_subtotal + v_expected_delivery_fee;
        v_order.delivery_fee := v_expected_delivery_fee;
      end if;
    elsif v_recorded_delivery_fee <> v_expected_delivery_fee
      or v_order.delivery_fee <> v_expected_delivery_fee
      or v_order.total <> v_subtotal + v_expected_delivery_fee
    then
      raise exception using errcode = 'P0001', message = 'Сумма доставки заказа не прошла проверку.';
    end if;

    insert into public.payments (
      order_id,
      provider,
      idempotency_key,
      status,
      amount,
      currency,
      receipt_email,
      next_reconcile_at,
      reconcile_until,
      metadata
    ) values (
      v_order.id,
      'yookassa',
      p_payment_idempotency_key,
      'pending',
      v_order.total,
      'RUB',
      v_email,
      now(),
      now() + interval '24 hours',
      jsonb_build_object('checkout_attempt', p_idempotency_key)
    ) returning * into v_payment;
  end if;

  update public.orders
  set payment_status = case
        when v_payment.status in ('paid', 'partially_refunded', 'refunded') then v_payment.status
        when v_payment.status in ('failed', 'cancelled') then v_payment.status
        else 'pending'
      end,
      fiscal_status = case
        when v_payment.status in ('failed', 'cancelled') then 'not_required'
        else fiscal_status
      end,
      status = case
        when v_payment.status in ('failed', 'cancelled') then 'cancelled'
        else status
      end,
      kitchen_status = case
        when v_payment.status in ('failed', 'cancelled') then 'cancelled'
        else kitchen_status
      end,
      is_operational = v_payment.status in ('paid', 'partially_refunded', 'refunded'),
      operational_started_at = case
        when v_payment.status in ('paid', 'partially_refunded', 'refunded')
          then coalesce(operational_started_at, now())
        else null
      end,
      source_metadata = coalesce(source_metadata, '{}'::jsonb)
        || jsonb_build_object('payment_required', true, 'payment_provider', 'yookassa'),
      updated_at = now()
  where id = v_order.id;

  insert into public.fiscal_receipts (
    order_id,
    payment_id,
    receipt_type,
    status,
    idempotency_key,
    amount,
    provider,
    receipt_phase,
    next_reconcile_at,
    reconcile_until,
    payload
  ) values (
    v_order.id,
    v_payment.id,
    'sale',
    'pending',
    'yookassa:payment:' || v_payment.id::text || ':prepayment',
    v_order.total,
    'yookassa',
    'payment_prepayment',
    now(),
    now() + interval '72 hours',
    jsonb_build_object('source', 'payment.create')
  ) on conflict (idempotency_key) do nothing;

  return query
  select v_order.id, v_order.total, v_order.display_number, v_payment.id, v_payment.idempotency_key;
end
$$;

create or replace function public.set_order_delivery_status_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid,
  p_actor_role text,
  p_device_source text default 'admin-orders'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_status not in ('handed_to_courier', 'handed_out') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус доставки.';
  end if;
  if p_actor_role not in ('owner', 'admin', 'manager', 'cashier') then
    raise exception using errcode = 'P0001', message = 'Недостаточно прав для изменения статуса доставки.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not v_order.is_operational or v_order.delivery_type <> 'delivery' then
    raise exception using errcode = 'P0001', message = 'Заказ доставки недоступен.';
  end if;

  if p_status = 'handed_to_courier' then
    if v_order.kitchen_status <> 'ready' then
      raise exception using errcode = 'P0001', message = 'Сначала отметьте заказ готовым.';
    end if;
    if not v_order.is_test and v_order.payment_status not in ('paid', 'partially_refunded') then
      raise exception using errcode = 'P0001', message = 'Оплата заказа ещё не подтверждена.';
    end if;
  elsif v_order.kitchen_status <> 'handed_to_courier' then
    raise exception using errcode = 'P0001', message = 'Сначала отметьте передачу заказа курьеру.';
  end if;

  update public.orders
  set kitchen_status = p_status,
      courier_handed_at = case when p_status = 'handed_to_courier' then coalesce(courier_handed_at, now()) else courier_handed_at end,
      handed_out_at = case when p_status = 'handed_out' then coalesce(handed_out_at, now()) else handed_out_at end,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_status_events (
    order_id, from_status, to_status, actor_user_id, actor_role, device_source, metadata
  ) values (
    p_order_id, v_order.kitchen_status, p_status, p_actor_id, p_actor_role, p_device_source,
    jsonb_build_object('is_test', v_order.is_test)
  );

  insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
  values (
    p_order_id, 'order.status_changed',
    jsonb_build_object(
      'order_id', p_order_id,
      'location_id', v_order.location_id,
      'from', v_order.kitchen_status,
      'to', p_status,
      'is_test', v_order.is_test
    ),
    'order:' || p_order_id || ':status:' || p_status
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'warnings', '[]'::jsonb);
end
$$;

create or replace view public.analytics_sale_items
with (security_invoker = true)
as
with confirmed_links as (
  select web_order_id, evotor_receipt_id
  from public.analytics_sale_reconciliations
  where status = 'confirmed'
)
select
  'pos_evotor:' || r.id::text as sale_id,
  'pos_evotor:' || i.id::text as sale_item_id,
  i.id as source_record_id,
  i.source_key as external_source_id,
  'pos_evotor'::text as source,
  i.evotor_product_id as source_product_id,
  case when mapping.status = 'confirmed' then mapping.karimoff_product_id end as product_id,
  coalesce(mapped_product.name, i.name) as product_name,
  case when mapping.status = 'confirmed' then mapped_product.category end as category,
  coalesce(mapping.status, 'unmapped')::text as mapping_status,
  case when r.receipt_type = 'return' then -abs(i.quantity) else abs(i.quantity) end::numeric as net_quantity,
  abs(i.quantity)::numeric as quantity,
  i.unit_price::numeric as unit_price,
  (i.line_total + i.discount)::numeric as gross_amount,
  i.discount::numeric as discount_amount,
  case when r.receipt_type = 'return' then i.line_total else 0 end::numeric as refund_amount,
  case when r.receipt_type = 'return' then -i.line_total when r.receipt_type = 'sale' then i.line_total else 0 end::numeric as net_revenue,
  r.closed_at as analytics_at,
  case r.receipt_type when 'return' then 'refund' when 'correction' then 'correction' else 'sale' end as operation_type
from public.evotor_receipt_items i
join public.evotor_receipts r on r.id = i.receipt_id
left join public.evotor_products ep
  on ep.store_id = r.store_id and ep.evotor_product_id = i.evotor_product_id
left join public.evotor_product_mappings mapping on mapping.evotor_product_id = ep.id
left join public.products mapped_product
  on mapped_product.id = mapping.karimoff_product_id and mapping.status = 'confirmed'
where not exists (
  select 1 from confirmed_links link where link.evotor_receipt_id = r.id
)

union all

select
  'web:' || o.id::text as sale_id,
  'web:' || i.id::text as sale_item_id,
  i.id as source_record_id,
  i.id::text as external_source_id,
  'web'::text as source,
  i.product_id::text as source_product_id,
  i.product_id,
  coalesce(p.name, i.product_name) as product_name,
  p.category,
  case when i.product_id is null then 'unmapped' else 'native' end::text as mapping_status,
  case when o.payment_status = 'refunded' then 0 else i.quantity end::numeric as net_quantity,
  i.quantity::numeric as quantity,
  i.unit_price::numeric as unit_price,
  i.line_total::numeric as gross_amount,
  0::numeric as discount_amount,
  case when o.payment_status = 'refunded' then i.line_total else 0 end::numeric as refund_amount,
  case
    when o.status = 'completed'
      and o.payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded')
      then case when o.payment_status = 'refunded' then 0 else i.line_total end
    else 0
  end::numeric as net_revenue,
  case when o.status = 'completed' then coalesce(o.kitchen_completed_at, o.updated_at, o.created_at) else o.created_at end as analytics_at,
  case when o.payment_status in ('refunded', 'partially_refunded') then 'refund' else 'sale' end as operation_type
from public.order_items i
join public.orders o on o.id = i.order_id
left join public.products p on p.id = i.product_id
where i.item_type = 'food';

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
  case when o.id is not null then coalesce(web_items.items_count, 0)::numeric else s.items_count end as items_count,
  s.currency,
  s.analytics_included,
  s.sale_count_eligible,
  s.discount_data_available,
  s.source_updated_at,
  s.source_metadata,
  case
    when o.id is null or o.source in ('pos', 'kiosk') then 'evotor'
    when coalesce(provider.payment_provider_count, 0) = 0 then 'unknown'
    when provider.payment_provider_count = 1 then provider.single_payment_provider
    else 'mixed'
  end as payment_provider
from public.analytics_sales s
left join public.orders o on s.sale_id = 'web:' || o.id::text
left join public.order_locations l on l.id = o.location_id
left join lateral (
  select sum(item.quantity)::numeric as items_count
  from public.order_items item
  where item.order_id = o.id and item.item_type = 'food'
) web_items on true
left join lateral (
  select count(distinct lower(payment.provider))::integer as payment_provider_count,
    min(lower(payment.provider)) as single_payment_provider
  from public.payments payment
  where payment.order_id = o.id
) provider on true
where o.id is null or not o.is_test;

revoke all on function public.set_order_delivery_status_atomic(uuid, text, uuid, text, text) from public;
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.set_order_delivery_status_atomic(uuid,text,uuid,text,text) from %I', v_role);
    end if;
  end loop;
  foreach v_role in array array['karimoff_app', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant execute on function public.set_order_delivery_status_atomic(uuid,text,uuid,text,text) to %I', v_role);
    end if;
  end loop;
end
$$;
