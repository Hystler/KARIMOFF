-- Local delivery address whitelist. The source snapshot and review status are
-- stored with each row; runtime checkout never calls an external geocoder.

create table if not exists public.delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.order_locations(id) on delete restrict,
  city text,
  street text not null,
  street_normalized text not null,
  house text not null,
  house_normalized text not null,
  building text not null default '',
  building_normalized text not null default '',
  display_name text,
  postal_code text,
  source text not null,
  source_id text,
  source_ids text[] not null default '{}',
  source_snapshot_version text,
  latitude double precision not null,
  longitude double precision not null,
  distance_meters integer not null,
  aerodrome_boundary_distance_meters double precision,
  coordinate_spread_meters double precision not null default 0,
  duplicate_count integer not null default 1,
  review_reasons text[] not null default '{}',
  is_available boolean not null default false,
  disabled_reason text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_addresses_street_normalized_nonempty check (btrim(street_normalized) <> ''),
  constraint delivery_addresses_house_normalized_nonempty check (btrim(house_normalized) <> ''),
  constraint delivery_addresses_coordinates_valid check (
    latitude between -90 and 90 and longitude between -180 and 180
  ),
  constraint delivery_addresses_distance_nonnegative check (distance_meters >= 0),
  constraint delivery_addresses_duplicate_count_positive check (duplicate_count >= 1),
  constraint delivery_addresses_display_name_length check (display_name is null or length(display_name) <= 120)
);

create unique index if not exists delivery_addresses_natural_key
  on public.delivery_addresses (location_id, street_normalized, house_normalized, building_normalized);
create index if not exists delivery_addresses_available_street_idx
  on public.delivery_addresses (location_id, street_normalized, house_normalized)
  where is_available;
create index if not exists delivery_addresses_review_idx
  on public.delivery_addresses (location_id, disabled_reason, street_normalized, house_normalized)
  where not is_available;

alter table public.delivery_addresses enable row level security;
revoke all privileges on table public.delivery_addresses from public;

do $$
declare
  v_role text;
begin
  for v_role in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all privileges on table public.delivery_addresses from %I', v_role);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update on table public.delivery_addresses to karimoff_app;
    drop policy if exists delivery_addresses_app_all on public.delivery_addresses;
    create policy delivery_addresses_app_all on public.delivery_addresses
      for all to karimoff_app using (true) with check (true);
  end if;
end
$$;

alter table public.orders add column if not exists delivery_address_id uuid;
alter table public.orders add column if not exists delivery_address_snapshot jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_delivery_address_fk'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_delivery_address_fk
      foreign key (delivery_address_id) references public.delivery_addresses(id) on delete set null;
  end if;
end
$$;

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
begin
  if p_delivery_type = 'delivery' then
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
    p_fulfillment_mode, p_requested_at, p_receipt_email, p_payment_idempotency_key
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
  return query select v_result.order_id::uuid, v_result.total::numeric,
    v_result.display_number::text, v_result.payment_id::uuid, v_result.payment_idempotency_key::text;
end
$$;

revoke all on function public.resolve_whitelisted_delivery_address(uuid, uuid, jsonb) from public;
revoke all on function public.create_site_order_from_whitelist(
  uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, boolean
) from public;
revoke all on function public.create_site_order_with_payment_from_whitelist(
  uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, text, text
) from public;

do $$
declare
  v_role text;
begin
  for v_role in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on function public.resolve_whitelisted_delivery_address(uuid, uuid, jsonb) from %I', v_role);
    execute format('revoke all on function public.create_site_order_from_whitelist(uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean, text, text, text, text, timestamptz, boolean) from %I', v_role);
    execute format('revoke all on function public.create_site_order_with_payment_from_whitelist(uuid, text, uuid, jsonb, text, jsonb, uuid, boolean, boolean, boolean, text, text, text, text, timestamptz, text, text) from %I', v_role);
  end loop;
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
