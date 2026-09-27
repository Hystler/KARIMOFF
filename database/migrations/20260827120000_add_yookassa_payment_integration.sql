-- YooKassa payment lifecycle, reconciliation, fiscal receipts and refund accounting.
-- Additive and safe for existing orders/payments; no provider calls are made here.

alter table public.payments
  add column if not exists provider_status text,
  add column if not exists receipt_registration text,
  add column if not exists payment_method text,
  add column if not exists refundable_amount numeric not null default 0,
  add column if not exists receipt_email text,
  add column if not exists request_fingerprint text,
  add column if not exists provider_created_at timestamptz,
  add column if not exists captured_at timestamptz,
  add column if not exists reconcile_attempts integer not null default 0,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists reconcile_until timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists reconcile_locked_at timestamptz,
  add column if not exists reconcile_locked_by text;

alter table public.refunds
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_status text,
  add column if not exists receipt_registration text,
  add column if not exists created_by_staff_id uuid references public.staff_users(id) on delete set null,
  add column if not exists request_fingerprint text,
  add column if not exists reconcile_attempts integer not null default 0,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists reconcile_until timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists reconcile_locked_at timestamptz,
  add column if not exists reconcile_locked_by text;

alter table public.fiscal_receipts
  add column if not exists refund_id uuid references public.refunds(id) on delete set null,
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_status text,
  add column if not exists receipt_phase text not null default 'sale',
  add column if not exists receipt_registration text,
  add column if not exists request_fingerprint text,
  add column if not exists reconcile_attempts integer not null default 0,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists reconcile_until timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists reconcile_locked_at timestamptz,
  add column if not exists reconcile_locked_by text;

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  refund_id uuid not null references public.refunds(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  description_snapshot text not null,
  quantity numeric(12, 3) not null,
  unit_amount numeric not null,
  amount numeric not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint refund_items_quantity_check check (quantity > 0),
  constraint refund_items_unit_amount_check check (unit_amount > 0),
  constraint refund_items_amount_check check (amount > 0),
  constraint refund_items_refund_order_item_key unique (refund_id, order_item_id)
);

alter table public.refund_items
  add column if not exists unit_amount numeric;
update public.refund_items
set unit_amount = amount / quantity
where unit_amount is null and quantity > 0;
alter table public.refund_items alter column unit_amount set not null;

create unique index if not exists payments_yookassa_provider_payment_key
  on public.payments (provider, provider_payment_id)
  where provider = 'yookassa' and provider_payment_id is not null;
create unique index if not exists payments_yookassa_order_key
  on public.payments (order_id)
  where provider = 'yookassa';
create index if not exists payments_yookassa_reconcile_idx
  on public.payments (next_reconcile_at, created_at)
  where provider = 'yookassa'
    and (status = 'pending' or receipt_registration = 'pending');
create index if not exists payments_yookassa_order_status_idx
  on public.payments (order_id, status, created_at desc)
  where provider = 'yookassa';

create unique index if not exists refunds_yookassa_provider_refund_key
  on public.refunds (provider, provider_refund_id)
  where provider = 'yookassa' and provider_refund_id is not null;
create index if not exists refunds_yookassa_reconcile_idx
  on public.refunds (next_reconcile_at, created_at)
  where provider = 'yookassa'
    and (status = 'pending' or receipt_registration = 'pending');
create index if not exists refund_items_refund_idx
  on public.refund_items (refund_id, created_at);
create index if not exists fiscal_receipts_refund_idx
  on public.fiscal_receipts (refund_id, created_at desc)
  where refund_id is not null;

create unique index if not exists fiscal_receipts_yookassa_provider_key
  on public.fiscal_receipts (provider, provider_receipt_id)
  where provider = 'yookassa' and provider_receipt_id is not null;
create index if not exists fiscal_receipts_yookassa_reconcile_idx
  on public.fiscal_receipts (next_reconcile_at, created_at)
  where provider = 'yookassa' and status = 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'refund_items_unit_amount_check'
      and conrelid = 'public.refund_items'::regclass
  ) then
    alter table public.refund_items add constraint refund_items_unit_amount_check
      check (unit_amount > 0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refund_items_line_amount_check'
      and conrelid = 'public.refund_items'::regclass
  ) then
    alter table public.refund_items add constraint refund_items_line_amount_check
      check (amount = unit_amount * quantity) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_yookassa_provider_status_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_yookassa_provider_status_check
      check (provider <> 'yookassa' or provider_status is null or provider_status in ('pending', 'waiting_for_capture', 'succeeded', 'canceled')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_yookassa_receipt_registration_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_yookassa_receipt_registration_check
      check (provider <> 'yookassa' or receipt_registration is null or receipt_registration in ('pending', 'succeeded', 'canceled')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_yookassa_amount_currency_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_yookassa_amount_currency_check
      check (provider <> 'yookassa' or (amount > 0 and currency = 'RUB')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_yookassa_reconcile_attempts_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_yookassa_reconcile_attempts_check
      check (reconcile_attempts >= 0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refunds_yookassa_provider_status_check'
      and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds add constraint refunds_yookassa_provider_status_check
      check (provider <> 'yookassa' or provider_status is null or provider_status in ('pending', 'succeeded', 'canceled')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refunds_internal_status_check'
      and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds add constraint refunds_internal_status_check
      check (provider <> 'yookassa' or status in ('pending', 'completed', 'failed')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refunds_yookassa_actor_check'
      and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds add constraint refunds_yookassa_actor_check
      check (provider <> 'yookassa' or created_by_staff_id is not null) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refunds_yookassa_reason_check'
      and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds add constraint refunds_yookassa_reason_check
      check (
        provider <> 'yookassa'
        or (reason is not null and char_length(btrim(reason)) between 1 and 500)
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_yookassa_fingerprint_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts add constraint fiscal_receipts_yookassa_fingerprint_check
      check (provider <> 'yookassa' or request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_yookassa_status_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts add constraint fiscal_receipts_yookassa_status_check
      check (provider <> 'yookassa' or provider_status is null or provider_status in ('pending', 'succeeded', 'canceled')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'fiscal_receipts_yookassa_phase_check'
      and conrelid = 'public.fiscal_receipts'::regclass
  ) then
    alter table public.fiscal_receipts add constraint fiscal_receipts_yookassa_phase_check
      check (receipt_phase in ('sale', 'payment_prepayment', 'prepayment_settlement', 'refund')) not valid;
  end if;
end
$$;

alter table public.refund_items validate constraint refund_items_unit_amount_check;
alter table public.refund_items validate constraint refund_items_line_amount_check;
alter table public.payments validate constraint payments_yookassa_provider_status_check;
alter table public.payments validate constraint payments_yookassa_receipt_registration_check;
alter table public.payments validate constraint payments_yookassa_amount_currency_check;
alter table public.payments validate constraint payments_yookassa_reconcile_attempts_check;
alter table public.refunds validate constraint refunds_yookassa_provider_status_check;
alter table public.refunds validate constraint refunds_internal_status_check;
alter table public.refunds validate constraint refunds_yookassa_actor_check;
alter table public.refunds validate constraint refunds_yookassa_reason_check;
alter table public.fiscal_receipts validate constraint fiscal_receipts_yookassa_fingerprint_check;
alter table public.fiscal_receipts validate constraint fiscal_receipts_yookassa_status_check;
alter table public.fiscal_receipts validate constraint fiscal_receipts_yookassa_phase_check;

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
begin
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
        || jsonb_build_object(
          'payment_required', true,
          'payment_provider', 'yookassa'
        ),
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
  select
    v_order.id,
    v_order.total,
    v_order.display_number,
    v_payment.id,
    v_payment.idempotency_key;
end
$$;

create or replace function public.refresh_yookassa_order_fiscal_status(p_order_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_total integer := 0;
  v_pending integer := 0;
  v_failed integer := 0;
  v_issued integer := 0;
  v_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ для фискального статуса не найден.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status in ('pending', 'processing'))::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'issued')::integer
  into v_total, v_pending, v_failed, v_issued
  from public.fiscal_receipts
  where order_id = p_order_id and provider = 'yookassa' and status <> 'cancelled';

  v_status := case
    when v_order.payment_status in ('cancelled', 'failed') then 'not_required'
    when v_failed > 0 then 'failed'
    when v_pending > 0 then 'pending'
    when v_order.payment_status = 'refunded' and v_total > 0 and v_issued = v_total then 'refunded'
    when v_issued > 0 and v_issued = v_total then 'issued'
    else 'pending'
  end;

  update public.orders set fiscal_status = v_status, updated_at = now() where id = p_order_id;
  return v_status;
end
$$;

create or replace function public.apply_yookassa_payment_state(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_provider_status text,
  p_paid boolean,
  p_amount numeric,
  p_currency text,
  p_receipt_registration text,
  p_payment_method text,
  p_refundable_amount numeric,
  p_provider_created_at timestamptz,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_internal_status text;
  v_order_payment_status text;
  v_completed_refund numeric := 0;
  v_activated boolean := false;
begin
  if p_provider_status not in ('pending', 'waiting_for_capture', 'succeeded', 'canceled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус платежа ЮKassa.';
  end if;
  if p_receipt_registration is not null
    and p_receipt_registration not in ('pending', 'succeeded', 'canceled')
  then
    raise exception using errcode = 'P0001', message = 'Некорректный статус чека ЮKassa.';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'yookassa' then
    raise exception using errcode = 'P0001', message = 'Платёж KARIMOFF не найден.';
  end if;
  if v_payment.provider_payment_id is not null
    and v_payment.provider_payment_id <> p_provider_payment_id
  then
    raise exception using errcode = 'P0001', message = 'Идентификатор платежа ЮKassa не совпадает.';
  end if;
  if v_payment.amount <> p_amount or v_payment.currency <> p_currency or p_currency <> 'RUB' then
    raise exception using errcode = 'P0001', message = 'Сумма или валюта платежа ЮKassa не совпадает с заказом.';
  end if;
  if p_provider_status = 'succeeded' and not p_paid then
    raise exception using errcode = 'P0001', message = 'ЮKassa вернула противоречивый статус платежа.';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ платежа не найден.';
  end if;

  select coalesce(sum(amount), 0)
  into v_completed_refund
  from public.refunds
  where payment_id = v_payment.id and provider = 'yookassa' and status = 'completed';

  v_internal_status := case
    when p_provider_status = 'succeeded' and p_paid then 'paid'
    when p_provider_status = 'canceled' then 'cancelled'
    else 'pending'
  end;
  if v_payment.status in ('refunded', 'partially_refunded') then
    v_internal_status := v_payment.status;
  elsif v_payment.status = 'paid' and v_internal_status <> 'paid' then
    v_internal_status := v_payment.status;
  end if;

  update public.payments
  set provider_payment_id = p_provider_payment_id,
      provider_status = p_provider_status,
      status = v_internal_status,
      receipt_registration = p_receipt_registration,
      payment_method = nullif(left(coalesce(p_payment_method, ''), 80), ''),
      refundable_amount = greatest(0, coalesce(p_refundable_amount, 0)),
      provider_created_at = coalesce(provider_created_at, p_provider_created_at),
      captured_at = coalesce(captured_at, p_captured_at),
      paid_at = case when v_internal_status = 'paid' then coalesce(paid_at, p_captured_at, now()) else paid_at end,
      cancelled_at = case when v_internal_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      confirmation_url = case when v_internal_status = 'pending' then confirmation_url else null end,
      reconcile_attempts = 0,
      last_reconciled_at = now(),
      next_reconcile_at = case
        when v_internal_status = 'pending'
          or (v_internal_status = 'paid' and coalesce(p_receipt_registration, 'pending') = 'pending')
        then now() + interval '10 seconds'
        else null
      end,
      reconcile_until = case
        when v_internal_status = 'paid' and coalesce(p_receipt_registration, 'pending') = 'pending'
          then greatest(coalesce(reconcile_until, now()), now() + interval '72 hours')
        else reconcile_until
      end,
      last_error_code = null,
      last_error_at = null,
      reconcile_locked_at = null,
      reconcile_locked_by = null,
      updated_at = now()
  where id = v_payment.id;

  update public.fiscal_receipts
  set provider_status = case when p_provider_status = 'canceled' then 'canceled' else p_receipt_registration end,
      receipt_registration = p_receipt_registration,
      status = case
        when p_provider_status = 'canceled' then 'cancelled'
        when p_receipt_registration = 'succeeded' then 'issued'
        when p_receipt_registration = 'canceled' then 'failed'
        else 'pending'
      end,
      fiscalized_at = case when p_receipt_registration = 'succeeded' then coalesce(fiscalized_at, now()) else fiscalized_at end,
      next_reconcile_at = null,
      last_reconciled_at = now(),
      last_error_code = null,
      last_error_at = null,
      updated_at = now()
  where payment_id = v_payment.id and provider = 'yookassa' and receipt_phase = 'payment_prepayment';

  if v_internal_status = 'paid' then
    v_order_payment_status := case
      when v_completed_refund >= v_order.total then 'refunded'
      when v_completed_refund > 0 then 'partially_refunded'
      else 'paid'
    end;
    v_activated := v_order.payment_status not in ('paid', 'partially_refunded', 'refunded');
    update public.orders
    set payment_status = v_order_payment_status,
        fiscal_status = case
          when v_completed_refund > 0 then fiscal_status
          when p_receipt_registration = 'succeeded' then 'issued'
          when p_receipt_registration = 'canceled' then 'failed'
          else 'pending'
        end,
        is_operational = case when v_completed_refund >= total then is_operational else true end,
        operational_started_at = case
          when v_completed_refund >= total then operational_started_at
          else coalesce(operational_started_at, now())
        end,
        updated_at = now()
    where id = v_order.id;

    insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
    values (
      v_order.id,
      'order.payment_succeeded',
      jsonb_build_object('order_id', v_order.id, 'provider', 'yookassa'),
      'order:' || v_order.id::text || ':payment:succeeded'
    ) on conflict (idempotency_key) do nothing;
  elsif v_internal_status = 'cancelled' and v_order.payment_status <> 'paid' then
    update public.orders
    set payment_status = 'cancelled',
        fiscal_status = 'not_required',
        status = 'cancelled',
        kitchen_status = 'cancelled',
        is_operational = false,
        cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where id = v_order.id;

    insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
    values (
      v_order.id,
      'order.payment_cancelled',
      jsonb_build_object('order_id', v_order.id, 'provider', 'yookassa'),
      'order:' || v_order.id::text || ':payment:cancelled'
    ) on conflict (idempotency_key) do nothing;
  end if;

  perform public.refresh_yookassa_order_fiscal_status(v_order.id);

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'payment_status', v_internal_status,
    'activated', v_activated
  );
end
$$;

create or replace function public.apply_yookassa_refund_state(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_receipt_registration text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_completed_total numeric;
  v_internal_status text;
begin
  if p_provider_status not in ('pending', 'succeeded', 'canceled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус возврата ЮKassa.';
  end if;
  if p_receipt_registration is not null
    and p_receipt_registration not in ('pending', 'succeeded', 'canceled')
  then
    raise exception using errcode = 'P0001', message = 'Некорректный статус чека возврата ЮKassa.';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found or v_refund.provider <> 'yookassa' then
    raise exception using errcode = 'P0001', message = 'Возврат KARIMOFF не найден.';
  end if;
  select * into v_payment from public.payments where id = v_refund.payment_id for update;
  if not found or v_payment.provider <> 'yookassa' then
    raise exception using errcode = 'P0001', message = 'Платёж возврата не найден.';
  end if;
  if v_refund.provider_refund_id is not null and v_refund.provider_refund_id <> p_provider_refund_id then
    raise exception using errcode = 'P0001', message = 'Идентификатор возврата ЮKassa не совпадает.';
  end if;
  if v_refund.amount <> p_amount or p_currency <> 'RUB' then
    raise exception using errcode = 'P0001', message = 'Сумма возврата ЮKassa не совпадает.';
  end if;

  v_internal_status := case
    when p_provider_status = 'succeeded' then 'completed'
    when p_provider_status = 'canceled' then 'failed'
    else 'pending'
  end;

  update public.refunds
  set provider_refund_id = p_provider_refund_id,
      provider_status = p_provider_status,
      receipt_registration = p_receipt_registration,
      status = v_internal_status,
      completed_at = case when v_internal_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      reconcile_attempts = 0,
      next_reconcile_at = case
        when v_internal_status = 'pending'
          or (v_internal_status = 'completed' and coalesce(p_receipt_registration, 'pending') = 'pending')
        then now() + interval '30 seconds'
        else null
      end,
      reconcile_until = case
        when v_internal_status = 'completed' and coalesce(p_receipt_registration, 'pending') = 'pending'
          then greatest(coalesce(reconcile_until, now()), now() + interval '72 hours')
        else reconcile_until
      end,
      last_reconciled_at = now(),
      last_error_code = null,
      last_error_at = null,
      reconcile_locked_at = null,
      reconcile_locked_by = null,
      updated_at = now()
  where id = v_refund.id;

  update public.fiscal_receipts
  set provider_status = case when p_provider_status = 'canceled' then 'canceled' else p_receipt_registration end,
      receipt_registration = p_receipt_registration,
      status = case
        when p_provider_status = 'canceled' then 'cancelled'
        when p_receipt_registration = 'succeeded' then 'issued'
        when p_receipt_registration = 'canceled' then 'failed'
        else 'pending'
      end,
      fiscalized_at = case
        when p_receipt_registration = 'succeeded' then coalesce(fiscalized_at, now())
        else fiscalized_at
      end,
      last_reconciled_at = now(),
      next_reconcile_at = null,
      last_error_code = null,
      last_error_at = null,
      updated_at = now()
  where refund_id = v_refund.id and provider = 'yookassa' and receipt_phase = 'refund';

  if v_internal_status = 'completed' then
    select coalesce(sum(amount), 0) into v_completed_total
    from public.refunds
    where payment_id = v_payment.id and status = 'completed';

    update public.payments
    set status = 'paid',
        refundable_amount = greatest(0, amount - v_completed_total),
        updated_at = now()
    where id = v_payment.id;

    update public.orders
    set payment_status = case when v_completed_total >= total then 'refunded' else 'partially_refunded' end,
        fiscal_status = case
          when p_receipt_registration = 'canceled' then 'failed'
          when p_receipt_registration = 'succeeded' and v_completed_total >= total then 'refunded'
          when p_receipt_registration = 'succeeded' then 'issued'
          else 'pending'
        end,
        updated_at = now()
    where id = v_refund.order_id;

    insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
    values (
      v_refund.order_id,
      'order.payment_refunded',
      jsonb_build_object('order_id', v_refund.order_id, 'refund_id', v_refund.id, 'provider', 'yookassa'),
      'refund:' || v_refund.id::text || ':succeeded'
    ) on conflict (idempotency_key) do nothing;
  end if;

  perform public.refresh_yookassa_order_fiscal_status(v_refund.order_id);

  return jsonb_build_object('ok', true, 'refund_status', v_internal_status);
end
$$;

create or replace function public.enforce_online_payment_kitchen_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce((new.source_metadata ->> 'payment_required')::boolean, false)
    and new.payment_status not in ('paid', 'partially_refunded', 'refunded')
    and (new.is_operational or new.kitchen_status not in ('new', 'cancelled'))
  then
    raise exception using
      errcode = 'P0001',
      message = 'Онлайн-заказ нельзя передать на кухню до подтверждения оплаты.';
  end if;
  return new;
end
$$;

drop trigger if exists orders_online_payment_kitchen_guard on public.orders;
create trigger orders_online_payment_kitchen_guard
before update of is_operational, kitchen_status, payment_status on public.orders
for each row execute function public.enforce_online_payment_kitchen_guard();

create or replace function public.queue_yookassa_prepayment_settlement()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_completed_refund numeric := 0;
  v_completed_refund_ids jsonb := '[]'::jsonb;
begin
  if new.kitchen_status <> 'handed_out'
    or old.kitchen_status = 'handed_out'
    or new.is_test
    or new.payment_status not in ('paid', 'partially_refunded')
  then
    return new;
  end if;

  select * into v_payment
  from public.payments
  where order_id = new.id and provider = 'yookassa' and status in ('paid', 'partially_refunded')
  order by created_at desc
  limit 1;
  if not found then return new; end if;

  select
    coalesce(sum(amount), 0),
    coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_completed_refund, v_completed_refund_ids
  from public.refunds
  where order_id = new.id and provider = 'yookassa' and status = 'completed';
  if v_completed_refund >= new.total then return new; end if;

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
    new.id,
    v_payment.id,
    'sale',
    'pending',
    'yookassa:payment:' || v_payment.id::text || ':settlement',
    new.total - v_completed_refund,
    'yookassa',
    'prepayment_settlement',
    now(),
    now() + interval '72 hours',
    jsonb_build_object(
      'source', 'order.handed_out',
      'included_refund_ids', v_completed_refund_ids
    )
  ) on conflict (idempotency_key) do nothing;

  update public.orders set fiscal_status = 'pending', updated_at = now() where id = new.id;
  return new;
end
$$;

drop trigger if exists orders_queue_yookassa_prepayment_settlement on public.orders;
create trigger orders_queue_yookassa_prepayment_settlement
after update of kitchen_status on public.orders
for each row execute function public.queue_yookassa_prepayment_settlement();

alter table public.refund_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.fiscal_receipts enable row level security;

revoke all privileges on table public.refund_items from public;
revoke all on function public.create_site_order_with_payment(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, text, text
) from public;
revoke all on function public.refresh_yookassa_order_fiscal_status(uuid)
from public;
revoke all on function public.apply_yookassa_payment_state(
  uuid, text, text, boolean, numeric, text, text, text, numeric, timestamptz, timestamptz
) from public;
revoke all on function public.apply_yookassa_refund_state(
  uuid, text, text, numeric, text, text
) from public;

do $$
declare
  v_role text;
begin
  for v_role in
    select rolname from pg_roles where rolname in ('anon', 'authenticated')
  loop
    execute format('revoke all privileges on table public.refund_items from %I', v_role);
    execute format(
      'revoke all on function public.create_site_order_with_payment(uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, text, text, text, text, timestamptz, text, text) from %I',
      v_role
    );
    execute format(
      'revoke all on function public.refresh_yookassa_order_fiscal_status(uuid) from %I',
      v_role
    );
    execute format(
      'revoke all on function public.apply_yookassa_payment_state(uuid, text, text, boolean, numeric, text, text, text, numeric, timestamptz, timestamptz) from %I',
      v_role
    );
    execute format(
      'revoke all on function public.apply_yookassa_refund_state(uuid, text, text, numeric, text, text) from %I',
      v_role
    );
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table
      public.payments,
      public.payment_events,
      public.refunds,
      public.refund_items,
      public.fiscal_receipts
    to karimoff_app;

    drop policy if exists payments_yookassa_app_all on public.payments;
    create policy payments_yookassa_app_all on public.payments
      for all to karimoff_app using (true) with check (true);
    drop policy if exists payment_events_yookassa_app_all on public.payment_events;
    create policy payment_events_yookassa_app_all on public.payment_events
      for all to karimoff_app using (true) with check (true);
    drop policy if exists refunds_yookassa_app_all on public.refunds;
    create policy refunds_yookassa_app_all on public.refunds
      for all to karimoff_app using (true) with check (true);
    drop policy if exists refund_items_yookassa_app_all on public.refund_items;
    create policy refund_items_yookassa_app_all on public.refund_items
      for all to karimoff_app using (true) with check (true);
    drop policy if exists fiscal_receipts_yookassa_app_all on public.fiscal_receipts;
    create policy fiscal_receipts_yookassa_app_all on public.fiscal_receipts
      for all to karimoff_app using (true) with check (true);

    grant execute on function public.create_site_order_with_payment(
      uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
      text, text, text, text, timestamptz, text, text
    ) to karimoff_app;
    grant execute on function public.refresh_yookassa_order_fiscal_status(uuid)
    to karimoff_app;
    grant execute on function public.apply_yookassa_payment_state(
      uuid, text, text, boolean, numeric, text, text, text, numeric, timestamptz, timestamptz
    ) to karimoff_app;
    grant execute on function public.apply_yookassa_refund_state(
      uuid, text, text, numeric, text, text
    ) to karimoff_app;
  end if;
end
$$;
