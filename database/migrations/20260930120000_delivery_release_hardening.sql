-- Additive hardening for the delivery pilot. The feature deliberately remains
-- disabled until a controlled rollout enables both feature flags.
create table if not exists public.delivery_location_settings (
  location_id uuid primary key references public.order_locations(id) on delete restrict,
  enabled boolean not null default false,
  center_longitude numeric(10, 7) not null,
  center_latitude numeric(10, 7) not null,
  radius_meters integer not null default 3000,
  excluded_areas jsonb not null default '[]'::jsonb,
  delivery_fee numeric(10, 2) not null default 200,
  free_threshold numeric(10, 2) not null default 2500,
  acceptance_start time not null default '11:00',
  acceptance_end time not null default '20:30',
  timezone text not null default 'Europe/Moscow',
  eta_minutes integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_location_settings_center_check check (
    center_longitude between -180 and 180 and center_latitude between -90 and 90
  ),
  constraint delivery_location_settings_pricing_check check (
    radius_meters > 0 and delivery_fee >= 0 and free_threshold >= 0 and eta_minutes > 0
  ),
  constraint delivery_location_settings_polygon_array_check check (jsonb_typeof(excluded_areas) = 'array')
);

-- Full mapped perimeter of Chkalovsky airfield (OSM relation 3300255); keep as
-- an explicit conservative exclusion until the owner visually confirms it on
-- Yandex Maps. Coordinates are [longitude, latitude].
insert into public.delivery_location_settings (
  location_id, enabled, center_longitude, center_latitude, radius_meters,
  excluded_areas, delivery_fee, free_threshold, acceptance_start,
  acceptance_end, timezone, eta_minutes
)
select location.id, false, 38.0557080, 55.9092210, 3000,
  jsonb_build_array(jsonb_build_object(
    'name', 'Аэродром Чкаловский — полный контур аэродрома',
    'source', 'OpenStreetMap relation 3300255; requires visual confirmation against Yandex Maps before enablement',
    'geojson', jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
      '[38.0917283,55.8678536]'::jsonb, '[38.086684,55.87081]'::jsonb, '[38.0867102,55.8711062]'::jsonb,
      '[38.086047,55.8714918]'::jsonb, '[38.0858376,55.8715676]'::jsonb, '[38.0856866,55.8716428]'::jsonb,
      '[38.0854777,55.8715175]'::jsonb, '[38.0853023,55.8716177]'::jsonb, '[38.0816954,55.8731663]'::jsonb,
      '[38.0820282,55.8732935]'::jsonb, '[38.082629,55.8730166]'::jsonb, '[38.0834659,55.8732815]'::jsonb,
      '[38.0828651,55.8736426]'::jsonb, '[38.0820926,55.8794446]'::jsonb, '[38.078595,55.8793242]'::jsonb,
      '[38.0780585,55.8793724]'::jsonb, '[38.077626,55.879914]'::jsonb, '[38.0766096,55.8821677]'::jsonb,
      '[38.0743299,55.8830306]'::jsonb, '[38.0739614,55.8832633]'::jsonb, '[38.0718552,55.8873429]'::jsonb,
      '[38.0715566,55.8890683]'::jsonb, '[38.0703662,55.890487]'::jsonb, '[38.0698991,55.8908813]'::jsonb,
      '[38.0674562,55.8926338]'::jsonb, '[38.0667982,55.8932133]'::jsonb, '[38.06663,55.8936104]'::jsonb,
      '[38.0655429,55.8943602]'::jsonb, '[38.065985,55.8946035]'::jsonb, '[38.0662187,55.894794]'::jsonb,
      '[38.0649483,55.8955407]'::jsonb, '[38.064561,55.8957494]'::jsonb, '[38.0627114,55.8967843]'::jsonb,
      '[38.0624707,55.8968814]'::jsonb, '[38.0623056,55.8968617]'::jsonb, '[38.0619588,55.8966324]'::jsonb,
      '[38.0619323,55.8966149]'::jsonb, '[38.0601327,55.8954248]'::jsonb, '[38.0601348,55.8952337]'::jsonb,
      '[38.060187,55.8952041]'::jsonb, '[38.0602536,55.8951553]'::jsonb, '[38.0601812,55.8951243]'::jsonb,
      '[38.0601264,55.8951008]'::jsonb, '[38.0600666,55.8950752]'::jsonb, '[38.0599432,55.8950268]'::jsonb,
      '[38.0596043,55.8950266]'::jsonb, '[38.0594425,55.89508]'::jsonb, '[38.0593896,55.8951067]'::jsonb,
      '[38.059332,55.8951377]'::jsonb, '[38.0592772,55.8951636]'::jsonb, '[38.0592052,55.8951693]'::jsonb,
      '[38.0590413,55.8951824]'::jsonb, '[38.0590297,55.8951875]'::jsonb, '[38.0588016,55.8952883]'::jsonb,
      '[38.0584644,55.8954373]'::jsonb, '[38.0574208,55.8958983]'::jsonb, '[38.0577088,55.896052]'::jsonb,
      '[38.0581811,55.8962794]'::jsonb, '[38.0574507,55.8967732]'::jsonb, '[38.0567751,55.89723]'::jsonb,
      '[38.0567201,55.8972679]'::jsonb, '[38.0563587,55.8975175]'::jsonb, '[38.0562856,55.8975175]'::jsonb,
      '[38.0562336,55.8975532]'::jsonb, '[38.0561817,55.8975901]'::jsonb, '[38.0561732,55.8976456]'::jsonb,
      '[38.0543019,55.8989376]'::jsonb, '[38.0534593,55.8990375]'::jsonb, '[38.0524592,55.8989039]'::jsonb,
      '[38.0514554,55.8985784]'::jsonb, '[38.0502945,55.8988111]'::jsonb, '[38.0488922,55.8986872]'::jsonb
    ) || jsonb_build_array(
      '[38.0479844,55.8984045]'::jsonb, '[38.0475561,55.8985849]'::jsonb, '[38.0471548,55.8985389]'::jsonb,
      '[38.0469975,55.8985238]'::jsonb, '[38.0468655,55.8985885]'::jsonb, '[38.0400259,55.8977988]'::jsonb,
      '[38.0397366,55.8977654]'::jsonb, '[38.0375498,55.8974516]'::jsonb, '[38.037429,55.8974343]'::jsonb,
      '[38.0277107,55.895904]'::jsonb, '[38.026703,55.8956667]'::jsonb, '[38.0186671,55.8944294]'::jsonb,
      '[38.0201658,55.8891414]'::jsonb, '[38.0203195,55.8887102]'::jsonb, '[38.0206115,55.8883038]'::jsonb,
      '[38.0210574,55.8878523]'::jsonb, '[38.0222465,55.8871259]'::jsonb, '[38.0230113,55.886686]'::jsonb,
      '[38.0235903,55.8863489]'::jsonb, '[38.024272,55.8857542]'::jsonb, '[38.024272,55.8856131]'::jsonb,
      '[38.02425,55.8854103]'::jsonb, '[38.0245968,55.8853901]'::jsonb, '[38.0246075,55.8850411]'::jsonb,
      '[38.0238672,55.8833021]'::jsonb, '[38.0284699,55.8826461]'::jsonb, '[38.0292423,55.8825378]'::jsonb,
      '[38.0273219,55.8764835]'::jsonb, '[38.0276652,55.8761344]'::jsonb, '[38.0285235,55.8758516]'::jsonb,
      '[38.0314385,55.8756035]'::jsonb, '[38.0317881,55.8756967]'::jsonb, '[38.0361725,55.8752615]'::jsonb,
      '[38.0367419,55.875095]'::jsonb, '[38.0385657,55.8749247]'::jsonb, '[38.0389598,55.8748889]'::jsonb,
      '[38.0395338,55.8762787]'::jsonb, '[38.040709,55.8800376]'::jsonb, '[38.0426569,55.8802578]'::jsonb,
      '[38.0567511,55.8777414]'::jsonb, '[38.0585232,55.8768278]'::jsonb, '[38.0711491,55.8706149]'::jsonb,
      '[38.068658,55.8689545]'::jsonb, '[38.0666481,55.8678024]'::jsonb, '[38.067015,55.8672738]'::jsonb,
      '[38.067079,55.8666597]'::jsonb, '[38.0716624,55.8667012]'::jsonb, '[38.0719321,55.8665243]'::jsonb,
      '[38.0789411,55.8665662]'::jsonb, '[38.0795168,55.866574]'::jsonb, '[38.0914123,55.8615874]'::jsonb,
      '[38.0919154,55.8619394]'::jsonb, '[38.0927853,55.861655]'::jsonb, '[38.0935517,55.8622572]'::jsonb,
      '[38.0929508,55.8625338]'::jsonb, '[38.0930838,55.8626187]'::jsonb, '[38.0929644,55.8626903]'::jsonb,
      '[38.0933633,55.8630685]'::jsonb, '[38.0916322,55.863647]'::jsonb, '[38.0924678,55.864446]'::jsonb,
      '[38.090227,55.8654988]'::jsonb, '[38.090243,55.8657719]'::jsonb, '[38.0908996,55.8661765]'::jsonb,
      '[38.0919489,55.8657333]'::jsonb, '[38.0931312,55.8665427]'::jsonb, '[38.0929523,55.8669653]'::jsonb,
      '[38.0931702,55.8673305]'::jsonb, '[38.0936797,55.8679649]'::jsonb, '[38.0929431,55.8684399]'::jsonb,
      '[38.0917283,55.8678536]'::jsonb
    )))
  )), 200, 2500, '11:00', '20:30', 'Europe/Moscow', 60
from public.order_locations location
where location.location_key = 'karimoff-main'
on conflict (location_id) do nothing;

alter table public.orders
  add column if not exists delivery_address_snapshot jsonb,
  add column if not exists delivery_street text,
  add column if not exists delivery_house text,
  add column if not exists delivery_apartment text,
  add column if not exists delivery_entrance text,
  add column if not exists delivery_floor text,
  add column if not exists delivery_intercom text,
  add column if not exists delivery_courier_comment text,
  add column if not exists delivery_latitude numeric(10, 7),
  add column if not exists delivery_longitude numeric(10, 7),
  add column if not exists delivery_distance_meters integer,
  add column if not exists delivery_eta_minutes integer,
  add column if not exists delivery_zone_validation text,
  add column if not exists delivery_validated_at timestamptz,
  add column if not exists delivery_status text;

alter table public.orders drop constraint if exists orders_delivery_snapshot_fields_check;
alter table public.orders add constraint orders_delivery_snapshot_fields_check check (
  source <> 'web' or delivery_type <> 'delivery'
  or payment_status not in ('paid', 'partially_refunded', 'refunded')
  or (
    jsonb_typeof(delivery_address_snapshot) = 'object'
    and delivery_zone_validation = 'available'
    and length(btrim(coalesce(delivery_street, ''))) > 0
    and length(btrim(coalesce(delivery_house, ''))) > 0
    and delivery_latitude between -90 and 90
    and delivery_longitude between -180 and 180
    and delivery_distance_meters between 0 and 3000
    and delivery_eta_minutes = 60
  )
) not valid;

alter table public.orders drop constraint if exists orders_delivery_status_check;
alter table public.orders add constraint orders_delivery_status_check check (
  delivery_status is null or delivery_status in (
    'awaiting_payment', 'paid', 'preparing', 'ready', 'courier_in_transit', 'delivered', 'cancelled'
  )
) not valid;

create index if not exists orders_delivery_status_idx
  on public.orders (location_id, delivery_status, created_at desc)
  where delivery_type = 'delivery';

create or replace function public.sync_delivery_order_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.delivery_type <> 'delivery' then
    new.delivery_status := null;
    return new;
  end if;

  if new.kitchen_status = 'cancelled' or new.status = 'cancelled' then
    new.delivery_status := 'cancelled';
  elsif new.kitchen_status = 'handed_out' then
    new.delivery_status := 'delivered';
  elsif new.kitchen_status = 'handed_to_courier' then
    new.delivery_status := 'courier_in_transit';
  elsif new.kitchen_status = 'ready' then
    new.delivery_status := 'ready';
  elsif new.payment_status in ('paid', 'partially_refunded', 'refunded') then
    if new.cooking_started_at is not null or new.kitchen_status in ('accepted', 'cooking') then
      new.delivery_status := 'preparing';
    else
      new.delivery_status := 'paid';
    end if;
  else
    new.delivery_status := 'awaiting_payment';
  end if;
  return new;
end
$$;

drop trigger if exists orders_sync_delivery_order_state on public.orders;
create trigger orders_sync_delivery_order_state
before insert or update of delivery_type, payment_status, kitchen_status, status, cooking_started_at
on public.orders
for each row execute function public.sync_delivery_order_state();

create or replace function public.protect_delivery_address_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.delivery_address_snapshot is not null and (
    new.delivery_address_snapshot is distinct from old.delivery_address_snapshot
    or new.delivery_street is distinct from old.delivery_street
    or new.delivery_house is distinct from old.delivery_house
    or new.delivery_apartment is distinct from old.delivery_apartment
    or new.delivery_entrance is distinct from old.delivery_entrance
    or new.delivery_floor is distinct from old.delivery_floor
    or new.delivery_intercom is distinct from old.delivery_intercom
    or new.delivery_courier_comment is distinct from old.delivery_courier_comment
    or new.delivery_latitude is distinct from old.delivery_latitude
    or new.delivery_longitude is distinct from old.delivery_longitude
    or new.delivery_distance_meters is distinct from old.delivery_distance_meters
    or new.delivery_zone_validation is distinct from old.delivery_zone_validation
    or new.delivery_validated_at is distinct from old.delivery_validated_at
  ) then
    raise exception using errcode = 'P0001', message = 'Адрес доставки уже закреплён за заказом и не может быть изменён.';
  end if;
  return new;
end
$$;

drop trigger if exists orders_protect_delivery_address_snapshot on public.orders;
create trigger orders_protect_delivery_address_snapshot
before update on public.orders
for each row execute function public.protect_delivery_address_snapshot();

create or replace function public.require_delivery_refund_before_cancel()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_completed numeric;
  v_pending boolean;
begin
  if old.delivery_type = 'delivery'
    and old.payment_status in ('paid', 'partially_refunded', 'refunded')
    and new.kitchen_status = 'cancelled'
    and old.kitchen_status is distinct from 'cancelled'
    and not old.is_test
  then
    select
      coalesce(sum(refund.amount) filter (where refund.status = 'completed'), 0),
      coalesce(bool_or(refund.status = 'pending'), false)
    into v_completed, v_pending
    from public.refunds refund
    where refund.order_id = old.id and refund.provider = 'yookassa';

    if old.payment_status <> 'refunded' or v_completed < old.total or v_pending then
      raise exception using errcode = 'P0001', message = 'Сначала подтвердите полный возврат заказа в ЮKassa.';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists orders_require_delivery_refund_before_cancel on public.orders;
create trigger orders_require_delivery_refund_before_cancel
before update of kitchen_status on public.orders
for each row execute function public.require_delivery_refund_before_cancel();

create or replace function public.enqueue_delivery_domain_events()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_event text;
begin
  if new.delivery_type <> 'delivery' or new.delivery_status is not distinct from old.delivery_status then
    return new;
  end if;
  if new.delivery_status = 'ready' then v_event := 'delivery.ready';
  elsif new.delivery_status = 'courier_in_transit' then v_event := 'delivery.courier_in_transit';
  elsif new.delivery_status = 'delivered' then v_event := 'delivery.delivered';
  else return new;
  end if;

  insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
  values (
    new.id,
    v_event,
    jsonb_build_object(
      'order_id', new.id,
      'location_id', new.location_id,
      'display_number', new.display_number,
      'is_test', new.is_test
    ),
    'order:' || new.id || ':' || v_event
  ) on conflict (idempotency_key) do nothing;
  return new;
end
$$;

drop trigger if exists orders_enqueue_delivery_domain_events on public.orders;
create trigger orders_enqueue_delivery_domain_events
after update of delivery_type, payment_status, kitchen_status, status, cooking_started_at on public.orders
for each row execute function public.enqueue_delivery_domain_events();

-- New, required snapshot argument makes the existing 16-argument RPC remain
-- available for old clients. Only the server runtime role may invoke this
-- delivery-specific overload.
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
  p_payment_idempotency_key text,
  p_delivery_snapshot jsonb
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
  v_created record;
  v_settings public.delivery_location_settings%rowtype;
  v_subtotal numeric;
  v_expected_fee numeric;
  v_order public.orders%rowtype;
  v_snapshot jsonb := coalesce(p_delivery_snapshot, '{}'::jsonb);
  v_location_id uuid;
  v_checked_at timestamptz;
begin
  if p_delivery_type <> 'delivery' then
    if p_delivery_snapshot is not null then
      raise exception using errcode = 'P0001', message = 'Для самовывоза адрес доставки не нужен.';
    end if;
    return query select * from public.create_site_order_with_payment(
      p_customer_id, p_delivery_type, p_address, p_comment, p_items, p_idempotency_key,
      p_personal_data_granted, p_offer_accepted, p_marketing_granted, p_document_version,
      p_source_path, p_user_agent_short, p_fulfillment_mode, p_requested_at,
      p_receipt_email, p_payment_idempotency_key
    );
    return;
  end if;

  if not coalesce((select settings.delivery_enabled and settings.delivery_coverage_enabled
    from public.site_settings settings where settings.id = 'main'), false) then
    raise exception using errcode = 'P0001', message = 'Доставка временно недоступна.';
  end if;
  if jsonb_typeof(v_snapshot) <> 'object'
    or v_snapshot->>'zone_validation' <> 'available'
    or length(btrim(coalesce(v_snapshot->>'street', ''))) = 0
    or length(btrim(coalesce(v_snapshot->>'house', ''))) = 0
  then
    raise exception using errcode = 'P0001', message = 'Проверьте адрес доставки.';
  end if;
  begin
    v_checked_at := (v_snapshot->>'validated_at')::timestamptz;
  exception when others then
    raise exception using errcode = 'P0001', message = 'Не удалось проверить адрес. Попробуйте ещё раз.';
  end;
  if v_checked_at < now() - interval '10 minutes' or v_checked_at > now() + interval '1 minute' then
    raise exception using errcode = 'P0001', message = 'Проверка адреса устарела. Проверьте адрес ещё раз.';
  end if;

  select settings.* into v_settings
  from public.delivery_location_settings settings
  join public.order_locations location on location.id = settings.location_id
  where location.location_key = 'karimoff-main' and location.is_active
  for share of settings;
  if not found or not v_settings.enabled then
    raise exception using errcode = 'P0001', message = 'Доставка временно недоступна.';
  end if;

  select location.id into v_location_id
  from public.order_locations location
  where location.location_key = 'karimoff-main' and location.is_active;

  select * into v_created
  from public.create_site_order_with_payment(
    p_customer_id, p_delivery_type, p_address, p_comment, p_items, p_idempotency_key,
    p_personal_data_granted, p_offer_accepted, p_marketing_granted, p_document_version,
    p_source_path, p_user_agent_short, p_fulfillment_mode, p_requested_at,
    p_receipt_email, p_payment_idempotency_key
  );

  select * into v_order from public.orders where id = v_created.order_id for update;
  if v_order.location_id <> v_location_id then
    raise exception using errcode = 'P0001', message = 'Точка доставки не настроена.';
  end if;
  select coalesce(sum(item.line_total) filter (where item.item_type = 'food'), 0)
  into v_subtotal from public.order_items item where item.order_id = v_order.id;
  v_expected_fee := case when v_subtotal < v_settings.free_threshold then v_settings.delivery_fee else 0 end;
  v_snapshot := v_snapshot || jsonb_build_object('delivery_fee', v_expected_fee);
  if v_order.delivery_fee <> v_expected_fee
    or coalesce((v_snapshot->>'eta_minutes')::integer, -1) <> v_settings.eta_minutes
  then
    raise exception using errcode = 'P0001', message = 'Стоимость доставки изменилась. Проверьте заказ ещё раз.';
  end if;

  if v_order.delivery_address_snapshot is not null then
    if (v_order.delivery_address_snapshot - 'validated_at') is distinct from (v_snapshot - 'validated_at') then
      raise exception using errcode = 'P0001', message = 'Адрес уже закреплён за этим заказом. Создайте новый заказ.';
    end if;
    v_snapshot := v_order.delivery_address_snapshot;
  else
    update public.orders set
      delivery_address_snapshot = v_snapshot,
      delivery_street = left(btrim(v_snapshot->>'street'), 160),
      delivery_house = left(btrim(v_snapshot->>'house'), 40),
      delivery_apartment = nullif(left(btrim(coalesce(v_snapshot->>'apartment', '')), 30), ''),
      delivery_entrance = nullif(left(btrim(coalesce(v_snapshot->>'entrance', '')), 30), ''),
      delivery_floor = nullif(left(btrim(coalesce(v_snapshot->>'floor', '')), 30), ''),
      delivery_intercom = nullif(left(btrim(coalesce(v_snapshot->>'intercom', '')), 60), ''),
      delivery_courier_comment = nullif(left(btrim(coalesce(v_snapshot->>'courier_comment', '')), 500), ''),
      delivery_latitude = (v_snapshot->>'latitude')::numeric,
      delivery_longitude = (v_snapshot->>'longitude')::numeric,
      delivery_distance_meters = (v_snapshot->>'distance_meters')::integer,
      delivery_eta_minutes = v_settings.eta_minutes,
      delivery_zone_validation = 'available',
      delivery_validated_at = v_checked_at,
      updated_at = now()
    where id = v_order.id;
  end if;

  return query select v_created.order_id, v_created.total, v_created.display_number,
    v_created.payment_id, v_created.payment_idempotency_key;
end
$$;

revoke all on function public.create_site_order_with_payment(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, text, text, text,
  text, timestamptz, text, text, jsonb
) from public;
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.create_site_order_with_payment(uuid,text,text,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamptz,text,text,jsonb) from %I', v_role);
    end if;
  end loop;
  foreach v_role in array array['karimoff_app', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant execute on function public.create_site_order_with_payment(uuid,text,text,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamptz,text,text,jsonb) to %I', v_role);
    end if;
  end loop;
end
$$;

alter table public.delivery_location_settings enable row level security;
revoke all privileges on table public.delivery_location_settings from public;
do $$
declare v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all privileges on table public.delivery_location_settings from %I', v_role);
    end if;
  end loop;
  foreach v_role in array array['karimoff_app', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant select on table public.delivery_location_settings to %I', v_role);
    end if;
  end loop;
end
$$;
drop policy if exists delivery_location_settings_runtime_read on public.delivery_location_settings;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    create policy delivery_location_settings_runtime_read
      on public.delivery_location_settings for select to karimoff_app using (true);
  end if;
end
$$;

comment on column public.orders.delivery_address_snapshot is
  'Immutable server-validated delivery address snapshot; personal data, never include in analytics/outbox payloads.';
comment on column public.orders.delivery_status is
  'Customer-facing normalized delivery lifecycle; independent from kitchen workflow.';
