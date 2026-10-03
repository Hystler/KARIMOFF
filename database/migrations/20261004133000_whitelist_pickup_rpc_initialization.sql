-- Initialize nullable delivery values for pickup on a fresh PostgreSQL connection.
-- Keep previously applied whitelist and combined migrations byte-identical.
create or replace function public.create_site_order_from_whitelist(
  p_customer_id uuid,
  p_delivery_type text,
  p_delivery_address_id uuid,
  p_delivery_details jsonb,
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
  p_is_test boolean
)
returns table(order_id uuid, total numeric)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid;
  v_delivery_text text;
  v_delivery_snapshot jsonb;
  v_result record;
  v_existing public.orders%rowtype;
begin
  if p_delivery_type = 'delivery' then
    if not p_is_test then
      raise exception using errcode = 'P0001', message = 'Доставка доступна только с онлайн-оплатой.';
    end if;
    select id into v_location_id from public.order_locations
    where location_key = 'karimoff-main' and is_default and is_active
    order by created_at limit 1;
    if v_location_id is null then
      raise exception using errcode = 'P0001', message = 'Не настроена точка доставки.';
    end if;
    select address_text, address_snapshot into v_delivery_text, v_delivery_snapshot
    from public.resolve_whitelisted_delivery_address(
      v_location_id, p_delivery_address_id, p_delivery_details
    );
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
    if found and (
      v_existing.delivery_type <> 'delivery'
      or (v_existing.delivery_address_id is not null and v_existing.delivery_address_id <> p_delivery_address_id)
      or (v_existing.delivery_address_id is null and v_existing.address is distinct from v_delivery_text)
    ) then
      raise exception using errcode = 'P0001', message = 'Ключ повторного запроса уже связан с другим адресом.';
    end if;
  elsif p_delivery_type = 'pickup' then
    if p_delivery_address_id is not null or p_delivery_details is not null then
      raise exception using errcode = 'P0001', message = 'Для самовывоза адрес не нужен.';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'Некорректный тип получения.';
  end if;

  select * into v_result from public.create_site_order(
    p_customer_id, p_delivery_type,
    case when p_delivery_type = 'delivery' then v_delivery_text else null end,
    p_comment, p_items, p_idempotency_key, p_personal_data_granted, p_offer_accepted,
    p_marketing_granted, p_document_version, p_source_path, p_user_agent_short,
    p_fulfillment_mode, p_requested_at, p_is_test
  );

  if p_delivery_type = 'delivery' then
    update public.orders set
      location_id = v_location_id,
      delivery_address_id = p_delivery_address_id,
      delivery_address_snapshot = v_delivery_snapshot,
      address = v_delivery_text,
      updated_at = now()
    where id = v_result.order_id;
  end if;
  return query select v_result.order_id::uuid, v_result.total::numeric;
end
$$;

create or replace function public.create_site_order_with_payment_from_whitelist(
  p_customer_id uuid,
  p_delivery_type text,
  p_delivery_address_id uuid,
  p_delivery_details jsonb,
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
  v_location_id uuid;
  v_delivery_text text;
  v_delivery_snapshot jsonb;
  v_result record;
  v_existing public.orders%rowtype;
  v_settings public.delivery_location_settings%rowtype;
  v_local_time time;
  v_payment public.payments%rowtype;
  v_request_hash text;
begin
  -- Serialize retries even before the canonical order row exists.
  perform pg_advisory_xact_lock(hashtext(p_idempotency_key::text));
  v_request_hash := encode(digest(jsonb_build_object(
    'customer', p_customer_id, 'type', p_delivery_type, 'address', p_delivery_address_id,
    'details', p_delivery_details, 'items', p_items, 'comment', p_comment,
    'fulfillment', p_fulfillment_mode, 'requested_at', p_requested_at,
    'email', lower(btrim(p_receipt_email)), 'payment_key', p_payment_idempotency_key
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.customer_id is distinct from p_customer_id
      or v_existing.source <> 'web'
      or v_existing.source_metadata->>'whitelist_checkout_request_hash' is distinct from v_request_hash then
      raise exception using errcode = 'P0001',
        message = 'Ключ повторного запроса уже связан с другим заказом или адресом.';
    end if;
    select payment.* into v_payment from public.payments payment
      where payment.order_id = v_existing.id and payment.provider = 'yookassa' for update;
    if not found or v_payment.idempotency_key is distinct from p_payment_idempotency_key
      or v_payment.amount <> v_existing.total or v_payment.currency <> 'RUB'
      or v_payment.receipt_email is distinct from lower(btrim(p_receipt_email)) then
      raise exception using errcode = 'P0001', message = 'Платёж заказа требует проверки.';
    end if;
    return query select v_existing.id, v_existing.total, v_existing.display_number,
      v_payment.id, v_payment.idempotency_key;
    return;
  end if;
  select id into v_location_id from public.order_locations
    where location_key = 'karimoff-main' and is_default and is_active
    order by created_at limit 1;
  if p_delivery_type = 'delivery' then
    if p_fulfillment_mode <> 'asap' then
      raise exception using errcode = 'P0001', message = 'Доставка оформляется как можно скорее.';
    end if;
    select * into v_settings from public.delivery_location_settings
      where location_id = v_location_id for share;
    if not found or not v_settings.enabled then
      raise exception using errcode = 'P0001', message = 'Доставка временно недоступна.';
    end if;
    v_local_time := date_trunc('minute', now() at time zone v_settings.timezone)::time;
    if not exists(select 1 from public.orders
      where customer_id = p_customer_id and idempotency_key = p_idempotency_key)
      and (v_local_time < v_settings.acceptance_start
        or v_local_time > v_settings.acceptance_end) then
      raise exception using errcode = 'P0001',
        message = 'Сегодня доставка уже закончилась. Вы можете выбрать самовывоз.';
    end if;
    select id into v_location_id from public.order_locations
    where location_key = 'karimoff-main' and is_default and is_active
    order by created_at limit 1;
    if v_location_id is null then
      raise exception using errcode = 'P0001', message = 'Не настроена точка доставки.';
    end if;
    select address_text, address_snapshot into v_delivery_text, v_delivery_snapshot
    from public.resolve_whitelisted_delivery_address(
      v_location_id, p_delivery_address_id, p_delivery_details
    );
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
    if found and (
      v_existing.delivery_type <> 'delivery'
      or (v_existing.delivery_address_id is not null and v_existing.delivery_address_id <> p_delivery_address_id)
      or (v_existing.delivery_address_id is null and v_existing.address is distinct from v_delivery_text)
    ) then
      raise exception using errcode = 'P0001', message = 'Ключ повторного запроса уже связан с другим адресом.';
    end if;
  elsif p_delivery_type = 'pickup' then
    if p_delivery_address_id is not null or p_delivery_details is not null then
      raise exception using errcode = 'P0001', message = 'Для самовывоза адрес не нужен.';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'Некорректный тип получения.';
  end if;

  select * into v_result from public.create_site_order_with_payment(
    p_customer_id, p_delivery_type,
    case when p_delivery_type = 'delivery' then v_delivery_text else null end,
    p_comment, p_items, p_idempotency_key, p_personal_data_granted, p_offer_accepted,
    p_marketing_granted, p_document_version, p_source_path, p_user_agent_short,
    p_fulfillment_mode, p_requested_at, p_receipt_email, p_payment_idempotency_key,
    case when p_delivery_type = 'delivery' then v_delivery_snapshot else null end
  );

  if p_delivery_type = 'delivery' then
    update public.orders set
      location_id = v_location_id,
      delivery_address_id = p_delivery_address_id,
      address = v_delivery_text,
      updated_at = now()
    where id = v_result.order_id;
  end if;
  update public.orders set source_metadata = source_metadata ||
    jsonb_build_object('whitelist_checkout_request_hash', v_request_hash)
    where id = v_result.order_id;
  return query select v_result.order_id::uuid, v_result.total::numeric,
    v_result.display_number::text, v_result.payment_id::uuid, v_result.payment_idempotency_key::text;
end
$$;

alter table public.delivery_whitelist_release_version
  add column if not exists pickup_rpc_initialized boolean not null default false;
update public.delivery_whitelist_release_version set pickup_rpc_initialized = true where version = 1;

