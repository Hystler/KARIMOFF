-- Combine whitelist identity with the existing delivery/payment snapshot flow.
-- Historical whitelist SQL is unchanged; payment, fiscal and KDS functions remain authoritative.
create or replace function public.resolve_whitelisted_delivery_address(
  p_location_id uuid,
  p_delivery_address_id uuid,
  p_delivery_details jsonb
)
returns table(address_text text, address_snapshot jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_address public.delivery_addresses%rowtype;
  v_settings public.delivery_location_settings%rowtype;
  v_details jsonb;
  v_base_text text;
  v_address_text text;
  v_detail_parts text[] := array[]::text[];
begin
  if p_delivery_address_id is null then
    raise exception using errcode = 'P0001', message = 'По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз.';
  end if;
  if jsonb_typeof(p_delivery_details) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'Некорректные данные доставки.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_delivery_details) as supplied(key)
    where supplied.key not in ('apartment', 'entrance', 'floor', 'intercom', 'courierComment')
  ) then
    raise exception using errcode = 'P0001', message = 'Некорректные данные доставки.';
  end if;
  if exists (
    select 1 from unnest(array['apartment', 'entrance', 'floor', 'intercom', 'courierComment']) as key(name)
    where p_delivery_details ? key.name
      and jsonb_typeof(p_delivery_details -> key.name) not in ('string', 'null')
  ) then
    raise exception using errcode = 'P0001', message = 'Некорректные данные доставки.';
  end if;
  if length(coalesce(p_delivery_details ->> 'apartment', '')) > 30
    or length(coalesce(p_delivery_details ->> 'entrance', '')) > 30
    or length(coalesce(p_delivery_details ->> 'floor', '')) > 30
    or length(coalesce(p_delivery_details ->> 'intercom', '')) > 60
    or length(coalesce(p_delivery_details ->> 'courierComment', '')) > 500
  then
    raise exception using errcode = 'P0001', message = 'Проверьте дополнительные данные доставки.';
  end if;

  select * into v_address
  from public.delivery_addresses
  where id = p_delivery_address_id
    and location_id = p_location_id
    and is_available
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз.';
  end if;

  select * into v_settings from public.delivery_location_settings where location_id = p_location_id;
  if not found or not v_settings.enabled or v_address.distance_meters > v_settings.radius_meters then
    raise exception using errcode = 'P0001', message = 'По этому адресу доставка пока недоступна.';
  end if;
  v_details := jsonb_build_object(
    'apartment', nullif(btrim(coalesce(p_delivery_details ->> 'apartment', '')), ''),
    'entrance', nullif(btrim(coalesce(p_delivery_details ->> 'entrance', '')), ''),
    'floor', nullif(btrim(coalesce(p_delivery_details ->> 'floor', '')), ''),
    'intercom', nullif(btrim(coalesce(p_delivery_details ->> 'intercom', '')), ''),
    'courier_comment', nullif(btrim(coalesce(p_delivery_details ->> 'courierComment', '')), '')
  );
  v_base_text := concat_ws(', ', v_address.street,
    coalesce(nullif(btrim(v_address.display_name), ''),
      concat_ws(' ', v_address.house,
        case when nullif(btrim(v_address.building), '') is not null then 'корп. ' || btrim(v_address.building) end)));

  if v_details ->> 'apartment' is not null then
    v_detail_parts := array_append(v_detail_parts, 'кв. ' || (v_details ->> 'apartment'));
  end if;
  if v_details ->> 'entrance' is not null then
    v_detail_parts := array_append(v_detail_parts, 'подъезд ' || (v_details ->> 'entrance'));
  end if;
  if v_details ->> 'floor' is not null then
    v_detail_parts := array_append(v_detail_parts, 'этаж ' || (v_details ->> 'floor'));
  end if;
  if v_details ->> 'intercom' is not null then
    v_detail_parts := array_append(v_detail_parts, 'домофон ' || (v_details ->> 'intercom'));
  end if;
  if v_details ->> 'courier_comment' is not null then
    v_detail_parts := array_append(v_detail_parts, 'курьеру: ' || (v_details ->> 'courier_comment'));
  end if;
  v_address_text := concat_ws(', ', v_base_text, nullif(array_to_string(v_detail_parts, ', '), ''));

  return query select v_address_text, jsonb_build_object(
    'address_text', v_address_text,
    'apartment', v_details->>'apartment',
    'entrance', v_details->>'entrance',
    'floor', v_details->>'floor',
    'intercom', v_details->>'intercom',
    'courier_comment', v_details->>'courier_comment',
    'delivery_fee', v_settings.delivery_fee,
    'eta_minutes', v_settings.eta_minutes,
    'zone_validation', 'available',
    'validated_at', now(),
    'delivery_address_id', v_address.id,
    'location_id', v_address.location_id,
    'city', v_address.city,
    'street', v_address.street,
    'street_normalized', v_address.street_normalized,
    'house', v_address.house,
    'house_normalized', v_address.house_normalized,
    'building', v_address.building,
    'building_normalized', v_address.building_normalized,
    'display_name', v_address.display_name,
    'display_address', v_address_text,
    'postal_code', v_address.postal_code,
    'latitude', v_address.latitude,
    'longitude', v_address.longitude,
    'distance_meters', v_address.distance_meters,
    'aerodrome_boundary_distance_meters', v_address.aerodrome_boundary_distance_meters,
    'source', v_address.source,
    'source_id', v_address.source_id,
    'source_ids', to_jsonb(v_address.source_ids),
    'source_snapshot_version', v_address.source_snapshot_version,
    'delivery_details', v_details
  );
end
$$;

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
  v_delivery record;
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
    select * into v_delivery from public.resolve_whitelisted_delivery_address(
      v_location_id, p_delivery_address_id, p_delivery_details
    );
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
    if found and (
      v_existing.delivery_type <> 'delivery'
      or (v_existing.delivery_address_id is not null and v_existing.delivery_address_id <> p_delivery_address_id)
      or (v_existing.delivery_address_id is null and v_existing.address is distinct from v_delivery.address_text)
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
    case when p_delivery_type = 'delivery' then v_delivery.address_text else null end,
    p_comment, p_items, p_idempotency_key, p_personal_data_granted, p_offer_accepted,
    p_marketing_granted, p_document_version, p_source_path, p_user_agent_short,
    p_fulfillment_mode, p_requested_at, p_is_test
  );

  if p_delivery_type = 'delivery' then
    update public.orders set
      location_id = v_location_id,
      delivery_address_id = p_delivery_address_id,
      delivery_address_snapshot = v_delivery.address_snapshot,
      address = v_delivery.address_text,
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
  v_delivery record;
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
    select * into v_delivery from public.resolve_whitelisted_delivery_address(
      v_location_id, p_delivery_address_id, p_delivery_details
    );
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
    if found and (
      v_existing.delivery_type <> 'delivery'
      or (v_existing.delivery_address_id is not null and v_existing.delivery_address_id <> p_delivery_address_id)
      or (v_existing.delivery_address_id is null and v_existing.address is distinct from v_delivery.address_text)
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
    case when p_delivery_type = 'delivery' then v_delivery.address_text else null end,
    p_comment, p_items, p_idempotency_key, p_personal_data_granted, p_offer_accepted,
    p_marketing_granted, p_document_version, p_source_path, p_user_agent_short,
    p_fulfillment_mode, p_requested_at, p_receipt_email, p_payment_idempotency_key,
    case when p_delivery_type = 'delivery' then v_delivery.address_snapshot else null end
  );

  if p_delivery_type = 'delivery' then
    update public.orders set
      location_id = v_location_id,
      delivery_address_id = p_delivery_address_id,
      address = v_delivery.address_text,
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

revoke all on function public.resolve_whitelisted_delivery_address(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_site_order_from_whitelist(
  uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
revoke all on function public.create_site_order_with_payment_from_whitelist(
  uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant execute on function public.resolve_whitelisted_delivery_address(uuid, uuid, jsonb) to karimoff_app;
    grant execute on function public.create_site_order_from_whitelist(
      uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
      text, text, text, text, timestamptz, boolean
    ) to karimoff_app;
    grant execute on function public.create_site_order_with_payment_from_whitelist(
      uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
      text, text, text, text, timestamptz, text, text
    ) to karimoff_app;
  end if;
end
$$;

create or replace function public.protect_delivery_whitelist_identity()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if old.delivery_address_snapshot is not null and (
    new.address is distinct from old.address
    or (old.delivery_address_id is not null and new.delivery_address_id is distinct from old.delivery_address_id)
    or (new.delivery_address_id is not null
      and new.delivery_address_id::text is distinct from old.delivery_address_snapshot->>'delivery_address_id')
  ) then
    raise exception using errcode = 'P0001', message = 'Адрес доставки уже закреплён за заказом.';
  end if;
  return new;
end $$;
drop trigger if exists orders_protect_delivery_whitelist_identity on public.orders;
create trigger orders_protect_delivery_whitelist_identity before update on public.orders
  for each row execute function public.protect_delivery_whitelist_identity();
revoke all on function public.protect_delivery_whitelist_identity() from public;
grant execute on function public.protect_delivery_whitelist_identity() to karimoff_app;

-- Marker is read-only to runtime and identifies the combined RPC version.
create table if not exists public.delivery_whitelist_release_version (
  version integer primary key check (version = 1)
);
insert into public.delivery_whitelist_release_version values (1) on conflict do nothing;
revoke all on public.delivery_whitelist_release_version from public, anon, authenticated;
grant select on public.delivery_whitelist_release_version to karimoff_app;
