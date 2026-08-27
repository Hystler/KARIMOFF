-- Fiscal refinements for YooKassa: immutable item snapshots, reusable receipt
-- email and provider-aware canonical analytics. Additive; no provider calls.

alter table public.customers
  add column if not exists receipt_email text;

alter table public.payments
  add column if not exists receipt_snapshot jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_receipt_email_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers add constraint customers_receipt_email_check
      check (
        receipt_email is null
        or (
          length(receipt_email) <= 254
          and receipt_email = lower(btrim(receipt_email))
          and receipt_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_yookassa_receipt_snapshot_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_yookassa_receipt_snapshot_check
      check (
        provider <> 'yookassa'
        or receipt_snapshot is null
        or (
          jsonb_typeof(receipt_snapshot) = 'array'
          and jsonb_array_length(receipt_snapshot) between 1 and 80
        )
      ) not valid;
  end if;
end
$$;

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

create or replace function public.capture_yookassa_payment_receipt_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_total numeric;
begin
  if new.provider <> 'yookassa' or new.receipt_snapshot is not null then
    return new;
  end if;

  select public.build_yookassa_order_receipt_snapshot(new.order_id), sum(line_total)
  into v_snapshot, v_total
  from public.order_items
  where order_id = new.order_id;

  if v_snapshot is null or jsonb_array_length(v_snapshot) = 0 then
    raise exception using errcode = 'P0001', message = 'Нельзя создать платёж без состава заказа.';
  end if;
  if v_total is distinct from new.amount then
    raise exception using errcode = 'P0001', message = 'Сумма состава заказа не совпадает с платежом.';
  end if;

  new.receipt_snapshot := v_snapshot;
  return new;
end
$$;

with snapshots as (
  select
    payment.id,
    public.build_yookassa_order_receipt_snapshot(payment.order_id) as snapshot,
    coalesce(sum(item.line_total), 0)::numeric as item_total
  from public.payments payment
  join public.order_items item on item.order_id = payment.order_id
  where payment.provider = 'yookassa'
    and payment.receipt_snapshot is null
  group by payment.id, payment.order_id
)
update public.payments payment
set receipt_snapshot = snapshots.snapshot,
    updated_at = now()
from snapshots
where payment.id = snapshots.id
  and snapshots.snapshot is not null
  and snapshots.item_total = payment.amount;

drop trigger if exists payments_capture_yookassa_receipt_snapshot on public.payments;
create trigger payments_capture_yookassa_receipt_snapshot
before insert on public.payments
for each row execute function public.capture_yookassa_payment_receipt_snapshot();

create or replace function public.enforce_yookassa_receipt_snapshot_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.provider = 'yookassa'
    and old.receipt_snapshot is not null
    and new.receipt_snapshot is distinct from old.receipt_snapshot
  then
    raise exception using
      errcode = 'P0001',
      message = 'Оплаченный состав заказа нельзя изменять без корректировки платежа и чека.';
  end if;
  return new;
end
$$;

drop trigger if exists payments_yookassa_receipt_snapshot_immutable on public.payments;
create trigger payments_yookassa_receipt_snapshot_immutable
before update of receipt_snapshot on public.payments
for each row execute function public.enforce_yookassa_receipt_snapshot_immutable();

create or replace function public.enforce_yookassa_payment_request_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (
    old.provider = 'yookassa'
    and (
      new.order_id is distinct from old.order_id
      or new.provider is distinct from old.provider
      or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency
      or new.receipt_snapshot is distinct from old.receipt_snapshot
      or (
        old.request_fingerprint is not null
        and new.receipt_email is distinct from old.receipt_email
      )
    )
  ) or (
    old.provider <> 'yookassa'
    and new.provider = 'yookassa'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Параметры платежа нельзя изменять после фиксации состава заказа.';
  end if;
  return new;
end
$$;

drop trigger if exists payments_yookassa_request_immutable on public.payments;
create trigger payments_yookassa_request_immutable
before update of order_id, provider, amount, currency, receipt_email, receipt_snapshot
on public.payments
for each row execute function public.enforce_yookassa_payment_request_immutable();

create or replace function public.enforce_paid_yookassa_order_item_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_order_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.order_id else null end;
  v_new_order_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.order_id else null end;
begin
  if exists (
    select 1
    from public.payments
    where order_id in (v_old_order_id, v_new_order_id)
      and provider = 'yookassa'
      and (
        receipt_snapshot is not null
        or status in ('paid', 'partially_refunded', 'refunded')
        or provider_status = 'succeeded'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Оплаченный заказ нельзя изменить без корректировки оплаты и чека.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists order_items_paid_yookassa_immutable on public.order_items;
create trigger order_items_paid_yookassa_immutable
before insert or update or delete on public.order_items
for each row execute function public.enforce_paid_yookassa_order_item_immutable();

create or replace function public.enforce_paid_yookassa_modifier_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_item_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.order_item_id else null end;
  v_new_item_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.order_item_id else null end;
begin
  if exists (
    select 1
    from public.order_items item
    join public.payments payment on payment.order_id = item.order_id
    where item.id in (v_old_item_id, v_new_item_id)
      and payment.provider = 'yookassa'
      and (
        payment.receipt_snapshot is not null
        or payment.status in ('paid', 'partially_refunded', 'refunded')
        or payment.provider_status = 'succeeded'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Модификаторы оплаченного заказа нельзя изменить без корректировки оплаты и чека.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists order_item_modifiers_paid_yookassa_immutable on public.order_item_modifiers;
create trigger order_item_modifiers_paid_yookassa_immutable
before insert or update or delete on public.order_item_modifiers
for each row execute function public.enforce_paid_yookassa_modifier_immutable();

create or replace function public.enforce_yookassa_order_total_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.total is distinct from old.total and exists (
    select 1
    from public.payments
    where order_id = old.id
      and provider = 'yookassa'
      and receipt_snapshot is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Сумму заказа нельзя изменять после создания платежа.';
  end if;
  return new;
end
$$;

drop trigger if exists orders_yookassa_total_immutable on public.orders;
create trigger orders_yookassa_total_immutable
before update of total on public.orders
for each row execute function public.enforce_yookassa_order_total_immutable();

create or replace function public.remember_yookassa_receipt_email()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid;
  v_email text := lower(btrim(coalesce(new.receipt_email, '')));
begin
  if new.provider <> 'yookassa'
    or new.status not in ('paid', 'partially_refunded', 'refunded')
    or v_email = ''
    or length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    return new;
  end if;

  select customer_id into v_customer_id
  from public.orders
  where id = new.order_id;

  if v_customer_id is not null then
    update public.customers
    set receipt_email = v_email,
        updated_at = now()
    where id = v_customer_id
      and receipt_email is distinct from v_email;
  end if;
  return new;
end
$$;

drop trigger if exists payments_remember_yookassa_receipt_email on public.payments;
create trigger payments_remember_yookassa_receipt_email
after insert or update of status, receipt_email on public.payments
for each row execute function public.remember_yookassa_receipt_email();

create or replace function public.refresh_yookassa_settlement_refund_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_completed_refund numeric := 0;
  v_refund_ids jsonb;
begin
  if new.provider <> 'yookassa' or new.status <> 'completed' then
    return new;
  end if;

  select
    coalesce(sum(amount), 0),
    coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_completed_refund, v_refund_ids
  from public.refunds
  where order_id = new.order_id
    and provider = 'yookassa'
    and status = 'completed';

  update public.fiscal_receipts
  set amount = greatest(payment.amount - v_completed_refund, 0),
      payload = jsonb_set(
        coalesce(payload, '{}'::jsonb),
        '{included_refund_ids}',
        v_refund_ids,
        true
      ),
      updated_at = now()
  from public.payments payment
  where public.fiscal_receipts.order_id = new.order_id
    and public.fiscal_receipts.payment_id = payment.id
    and public.fiscal_receipts.provider = 'yookassa'
    and public.fiscal_receipts.receipt_phase = 'prepayment_settlement'
    and public.fiscal_receipts.request_fingerprint is null;
  return new;
end
$$;

drop trigger if exists refunds_refresh_yookassa_settlement_snapshot on public.refunds;
create trigger refunds_refresh_yookassa_settlement_snapshot
after insert or update of status on public.refunds
for each row execute function public.refresh_yookassa_settlement_refund_snapshot();

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
  where order_id = new.id
    and provider = 'yookassa'
    and status in ('paid', 'partially_refunded')
  order by created_at desc
  limit 1;
  if not found then return new; end if;

  select
    coalesce(sum(amount), 0),
    coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_completed_refund, v_completed_refund_ids
  from public.refunds
  where order_id = new.id
    and provider = 'yookassa'
    and status = 'completed';
  if v_completed_refund >= v_payment.amount then return new; end if;

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
    v_payment.amount - v_completed_refund,
    'yookassa',
    'prepayment_settlement',
    now(),
    now() + interval '72 hours',
    jsonb_build_object(
      'source', 'order.handed_out',
      'included_refund_ids', v_completed_refund_ids
    )
  ) on conflict (idempotency_key) do nothing;

  update public.orders
  set fiscal_status = 'pending', updated_at = now()
  where id = new.id;
  return new;
end
$$;

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
  s.items_count,
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
left join public.orders o
  on s.sale_id = 'web:' || o.id::text
left join public.order_locations l on l.id = o.location_id
left join lateral (
  select
    count(distinct lower(payment.provider))::integer as payment_provider_count,
    min(lower(payment.provider)) as single_payment_provider
  from public.payments payment
  where payment.order_id = o.id
) provider on true
where o.id is null or not o.is_test;

alter table public.customers validate constraint customers_receipt_email_check;
alter table public.payments validate constraint payments_yookassa_receipt_snapshot_check;

revoke all on function public.build_yookassa_order_receipt_snapshot(uuid)
from public, anon, authenticated;
revoke all on function public.capture_yookassa_payment_receipt_snapshot()
from public, anon, authenticated;
revoke all on function public.enforce_yookassa_receipt_snapshot_immutable()
from public, anon, authenticated;
revoke all on function public.enforce_yookassa_payment_request_immutable()
from public, anon, authenticated;
revoke all on function public.enforce_paid_yookassa_order_item_immutable()
from public, anon, authenticated;
revoke all on function public.enforce_paid_yookassa_modifier_immutable()
from public, anon, authenticated;
revoke all on function public.enforce_yookassa_order_total_immutable()
from public, anon, authenticated;
revoke all on function public.remember_yookassa_receipt_email()
from public, anon, authenticated;
revoke all on function public.refresh_yookassa_settlement_refund_snapshot()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant execute on function public.build_yookassa_order_receipt_snapshot(uuid)
    to karimoff_app;
    grant execute on function public.capture_yookassa_payment_receipt_snapshot()
    to karimoff_app;
    grant execute on function public.enforce_yookassa_receipt_snapshot_immutable()
    to karimoff_app;
    grant execute on function public.enforce_yookassa_payment_request_immutable()
    to karimoff_app;
    grant execute on function public.enforce_paid_yookassa_order_item_immutable()
    to karimoff_app;
    grant execute on function public.enforce_paid_yookassa_modifier_immutable()
    to karimoff_app;
    grant execute on function public.enforce_yookassa_order_total_immutable()
    to karimoff_app;
    grant execute on function public.remember_yookassa_receipt_email()
    to karimoff_app;
    grant execute on function public.refresh_yookassa_settlement_refund_snapshot()
    to karimoff_app;
    grant select on table public.canonical_analytics_sales to karimoff_app;
  end if;
end
$$;
