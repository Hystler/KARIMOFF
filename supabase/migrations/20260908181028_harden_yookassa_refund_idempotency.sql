-- Forward-only application fix. Production application requires separate review.
-- Existing signatures and CREATE OR REPLACE preserve ownership, grants and callers.
begin;

do $preconditions$
begin
  if to_regprocedure('public.apply_yookassa_payment_state(uuid,text,text,boolean,numeric,text,text,text,numeric,timestamptz,timestamptz)') is null
    or to_regprocedure('public.apply_yookassa_refund_state(uuid,text,text,numeric,text,text)') is null
  then
    raise exception 'YooKassa payment migrations must be installed before this migration.';
  end if;
end
$preconditions$;

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

  -- A paid payment cannot return to an earlier provider state or cancel its receipt.
  if v_payment.status in ('paid', 'partially_refunded', 'refunded')
    and p_provider_status is distinct from 'succeeded'
  then
    p_provider_status := 'succeeded';
    p_paid := true;
    p_receipt_registration := v_payment.receipt_registration;
    p_payment_method := v_payment.payment_method;
    p_refundable_amount := v_payment.refundable_amount;
  end if;
  if v_payment.receipt_registration in ('succeeded', 'canceled') then
    p_receipt_registration := v_payment.receipt_registration;
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
      refundable_amount = least(
        greatest(0, coalesce(p_refundable_amount, 0)),
        greatest(0, v_payment.amount - v_completed_refund)
      ),
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
  where payment_id = v_payment.id and provider = 'yookassa' and receipt_phase = 'payment_prepayment'
    and status not in ('issued', 'failed', 'cancelled');

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
  v_payment_id uuid;
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

  select payment_id into v_payment_id from public.refunds
  where id = p_refund_id and provider = 'yookassa';
  if not found then
    raise exception using errcode = 'P0001', message = 'Возврат KARIMOFF не найден.';
  end if;
  -- Match refund creation: serialize on the payment before locking its refund.
  select * into v_payment from public.payments where id = v_payment_id for update;
  if not found or v_payment.provider <> 'yookassa' then
    raise exception using errcode = 'P0001', message = 'Платёж возврата не найден.';
  end if;
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found or v_refund.provider <> 'yookassa' or v_refund.payment_id <> v_payment.id then
    raise exception using errcode = 'P0001', message = 'Возврат KARIMOFF не найден.';
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

  -- Financial terminal states are immutable; their pending receipts may still finish.
  if v_refund.status in ('completed', 'failed') then
    v_internal_status := v_refund.status;
    if p_provider_status is distinct from (case when v_refund.status = 'completed' then 'succeeded' else 'canceled' end) then
      p_receipt_registration := v_refund.receipt_registration;
    end if;
    p_provider_status := case when v_refund.status = 'completed' then 'succeeded' else 'canceled' end;
  end if;
  if v_refund.receipt_registration in ('succeeded', 'canceled') then
    p_receipt_registration := v_refund.receipt_registration;
  end if;

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
    where payment_id = v_payment.id and provider = 'yookassa' and status = 'completed';

    update public.payments
    set status = 'paid',
        refundable_amount = least(
          greatest(0, coalesce(v_payment.refundable_amount, 0)),
          greatest(0, amount - v_completed_total)
        ),
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

commit;
