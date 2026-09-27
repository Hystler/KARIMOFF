-- Personal loyalty cards use opaque, signed QR payloads. The QR never contains
-- a phone number or customer id and cannot authorize point redemption.

create table if not exists public.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  public_code text not null,
  token_version integer not null default 1,
  status text not null default 'active',
  issued_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint loyalty_cards_customer_unique unique (customer_id),
  constraint loyalty_cards_public_code_unique unique (public_code),
  constraint loyalty_cards_public_code_check check (public_code ~ '^[A-Z0-9]{12}$'),
  constraint loyalty_cards_token_version_check check (token_version > 0),
  constraint loyalty_cards_status_check check (status in ('active', 'revoked'))
);

create index if not exists loyalty_cards_status_idx
  on public.loyalty_cards (status, updated_at desc);

drop trigger if exists loyalty_cards_set_updated_at on public.loyalty_cards;
create trigger loyalty_cards_set_updated_at
before update on public.loyalty_cards
for each row execute function public.set_updated_at();

alter table public.loyalty_cards enable row level security;
revoke all privileges on table public.loyalty_cards from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.loyalty_cards to karimoff_app;
    drop policy if exists loyalty_cards_app_all on public.loyalty_cards;
    create policy loyalty_cards_app_all
      on public.loyalty_cards
      for all
      to karimoff_app
      using (true)
      with check (true);
  end if;
end
$$;

-- Keep the established POS function intact and add a customer-aware overload.
-- Existing callers continue to use the previous signature.
create or replace function public.create_pos_order_atomic(
  p_location_id uuid,
  p_customer_name text,
  p_comment text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_fulfillment_mode text,
  p_requested_at timestamptz,
  p_is_test boolean,
  p_customer_id uuid
)
returns table(order_id uuid, total numeric, display_number text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result record;
  v_customer public.customers%rowtype;
  v_existing public.orders%rowtype;
begin
  if p_customer_id is not null then
    select * into v_customer
    from public.customers
    where id = p_customer_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'Карта гостя не найдена.';
    end if;
  end if;

  select * into v_result
  from public.create_pos_order_atomic(
    p_location_id,
    case when p_customer_id is null then p_customer_name else v_customer.name end,
    p_comment,
    p_items,
    p_idempotency_key,
    p_actor_id,
    p_actor_role,
    p_fulfillment_mode,
    p_requested_at,
    p_is_test
  );

  select * into v_existing
  from public.orders
  where id = v_result.order_id
  for update;

  if p_customer_id is not null then
    if v_existing.customer_id is not null and v_existing.customer_id <> p_customer_id then
      raise exception using errcode = 'P0001', message = 'К этому заказу уже привязана другая карта гостя.';
    end if;

    update public.orders
    set customer_id = p_customer_id,
        customer_name = v_customer.name,
        customer_phone = v_customer.phone,
        public_display_name = v_customer.name,
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('loyalty_card_linked', true),
        updated_at = now()
    where id = v_result.order_id;
  end if;

  return query
  select v_result.order_id::uuid, v_result.total::numeric, v_result.display_number::text;
end
$$;

revoke all on function public.create_pos_order_atomic(
  uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz, boolean, uuid
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant execute on function public.create_pos_order_atomic(
      uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz, boolean, uuid
    ) to karimoff_app;
  end if;
end
$$;

comment on table public.loyalty_cards is
  'Personal KARIMOFF loyalty card identifiers. QR signatures are generated server-side and are not stored.';
