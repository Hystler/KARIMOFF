begin;

do $test$
declare
  v_actor_guarded boolean := false;
  v_customer_id uuid;
  v_order_id uuid;
  v_payment_id uuid;
  v_payment_key text := gen_random_uuid()::text;
  v_product_id uuid;
  v_refund_id uuid;
  v_second_refund_id uuid;
  v_staff_id uuid;
  v_total numeric;
  v_count integer;
  v_guarded boolean := false;
  v_payment_status text;
  v_order_payment_status text;
  v_operational boolean;
begin
  insert into public.customers (name, phone, phone_verified_at)
  values (
    'YooKassa test customer',
    '+7' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
    now()
  ) returning id into v_customer_id;

  insert into public.staff_users (name, phone, password_hash, role, is_active)
  values (
    'YooKassa test owner',
    '+7' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
    'test-only',
    'owner',
    true
  ) returning id into v_staff_id;

  insert into public.products (name, slug, category, price, is_active)
  values (
    'YooKassa test product',
    'yookassa-' || gen_random_uuid()::text,
    'Test',
    123,
    true
  ) returning id into v_product_id;

  select result.order_id, result.payment_id, result.total
  into v_order_id, v_payment_id, v_total
  from public.create_site_order_with_payment(
    v_customer_id,
    'pickup',
    null,
    null,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 2)),
    gen_random_uuid(),
    true,
    true,
    false,
    'test',
    '/test/yookassa',
    'test',
    'asap',
    null,
    'receipt@example.test',
    v_payment_key
  ) result;

  if v_total <> 246 then
    raise exception 'Server-side YooKassa order total is wrong: %', v_total;
  end if;

  select payment_status, is_operational
  into v_order_payment_status, v_operational
  from public.orders where id = v_order_id;
  if v_order_payment_status <> 'pending' or v_operational then
    raise exception 'Unpaid YooKassa order entered the operational queue.';
  end if;

  begin
    update public.orders set is_operational = true where id = v_order_id;
  exception when sqlstate 'P0001' then
    v_guarded := true;
  end;
  if not v_guarded then
    raise exception 'Online payment KDS guard did not reject an unpaid order.';
  end if;

  perform public.apply_yookassa_payment_state(
    v_payment_id,
    'test-provider-payment',
    'succeeded',
    true,
    v_total,
    'RUB',
    'pending',
    'bank_card',
    v_total,
    now(),
    now()
  );
  perform public.apply_yookassa_payment_state(
    v_payment_id,
    'test-provider-payment',
    'succeeded',
    true,
    v_total,
    'RUB',
    'pending',
    'bank_card',
    v_total,
    now(),
    now()
  );

  select status into v_payment_status from public.payments where id = v_payment_id;
  select payment_status, is_operational
  into v_order_payment_status, v_operational
  from public.orders where id = v_order_id;
  select count(*) into v_count
  from public.order_outbox
  where aggregate_id = v_order_id and event_type = 'order.payment_succeeded';
  if v_payment_status <> 'paid' or v_order_payment_status <> 'paid' or not v_operational or v_count <> 1 then
    raise exception 'Verified payment was not applied exactly once.';
  end if;

  begin
    insert into public.refunds (
      payment_id, order_id, provider, idempotency_key, status, amount, reason
    ) values (
      v_payment_id, v_order_id, 'yookassa', gen_random_uuid()::text, 'pending', 1, 'test'
    );
  exception when check_violation then
    v_actor_guarded := true;
  end;
  if not v_actor_guarded then
    raise exception 'YooKassa refund without an accountable staff actor was accepted.';
  end if;

  insert into public.refunds (
    payment_id,
    order_id,
    provider,
    idempotency_key,
    status,
    amount,
    reason,
    created_by_staff_id,
    metadata
  ) values (
    v_payment_id,
    v_order_id,
    'yookassa',
    gen_random_uuid()::text,
    'pending',
    123,
    'Partial test refund',
    v_staff_id,
    '{"refund_kind":"partial"}'::jsonb
  ) returning id into v_refund_id;

  insert into public.refund_items (
    refund_id, order_item_id, description_snapshot, quantity, unit_amount, amount
  )
  select v_refund_id, id, product_name, 1, unit_price, unit_price
  from public.order_items
  where order_id = v_order_id
  limit 1;

  perform public.apply_yookassa_refund_state(
    v_refund_id,
    'test-provider-refund-1',
    'succeeded',
    123,
    'RUB',
    'pending'
  );

  select status into v_payment_status from public.payments where id = v_payment_id;
  select payment_status into v_order_payment_status from public.orders where id = v_order_id;
  if v_payment_status <> 'paid' or v_order_payment_status <> 'partially_refunded' then
    raise exception 'Partial refund state was not propagated.';
  end if;

  insert into public.refunds (
    payment_id,
    order_id,
    provider,
    idempotency_key,
    status,
    amount,
    reason,
    created_by_staff_id,
    metadata
  ) values (
    v_payment_id,
    v_order_id,
    'yookassa',
    gen_random_uuid()::text,
    'pending',
    123,
    'Final test refund',
    v_staff_id,
    '{"refund_kind":"full"}'::jsonb
  ) returning id into v_second_refund_id;

  perform public.apply_yookassa_refund_state(
    v_second_refund_id,
    'test-provider-refund-2',
    'succeeded',
    123,
    'RUB',
    'succeeded'
  );
  perform public.apply_yookassa_refund_state(
    v_second_refund_id,
    'test-provider-refund-2',
    'succeeded',
    123,
    'RUB',
    'succeeded'
  );

  select status into v_payment_status from public.payments where id = v_payment_id;
  select payment_status into v_order_payment_status from public.orders where id = v_order_id;
  select count(*) into v_count
  from public.order_outbox
  where aggregate_id = v_order_id and event_type = 'order.payment_refunded';
  if v_payment_status <> 'paid' or v_order_payment_status <> 'refunded' or v_count <> 2 then
    raise exception 'Full aggregate refund was not applied idempotently.';
  end if;
end
$test$;

rollback;
