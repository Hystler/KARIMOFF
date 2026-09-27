-- Keep server-authoritative price locking compatible with PostgreSQL:
-- lock product rows directly, without a grouped relation in the locking query.

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
  where p.id in (
    select x.product_id
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
  )
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
