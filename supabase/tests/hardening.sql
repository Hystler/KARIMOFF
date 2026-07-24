do $test$
declare
  v_customer_id uuid;
  v_product_id uuid;
  v_ingredient_id uuid;
  v_order_id uuid;
  v_second_order_id uuid;
  v_total numeric;
  v_quantity numeric;
  v_count integer;
  v_failed boolean := false;
begin
  insert into public.customers (name, phone)
  values (
    'Hardening test',
    '+7' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
  )
  returning id into v_customer_id;

  insert into public.products (name, slug, category, price, is_active)
  values (
    'Hardening product',
    'hardening-' || gen_random_uuid()::text,
    'Тест',
    123,
    true
  )
  returning id into v_product_id;

  insert into public.ingredients (name, unit, cost_per_unit)
  values ('Hardening ingredient', 'pcs', 10)
  returning id into v_ingredient_id;

  insert into public.product_ingredients (product_id, ingredient_id, quantity, unit)
  values (v_product_id, v_ingredient_id, 2, 'pcs');

  insert into public.inventory_items (ingredient_id, current_quantity, unit)
  values (v_ingredient_id, 10, 'pcs');

  select result.order_id, result.total
  into v_order_id, v_total
  from public.create_site_order(
    v_customer_id,
    'pickup',
    null,
    null,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 2,
      'price', 1
    )),
    gen_random_uuid(),
    true,
    true,
    false,
    'test',
    '/test',
    'test'
  ) result;

  if v_total <> 246 then
    raise exception 'Server-authoritative total failed: expected 246, got %', v_total;
  end if;

  select count(*) into v_count
  from public.order_items
  where order_id = v_order_id and unit_price = 123 and line_total = 246;

  if v_count <> 1 then
    raise exception 'Server-authoritative line price was not stored.';
  end if;

  perform public.set_order_status_atomic(v_order_id, 'completed', null, '/test');

  select current_quantity into v_quantity
  from public.inventory_items
  where ingredient_id = v_ingredient_id;

  if v_quantity <> 6 then
    raise exception 'Inventory deduction failed: expected 6, got %', v_quantity;
  end if;

  perform public.set_order_status_atomic(v_order_id, 'in_progress', null, '/test');
  perform public.set_order_status_atomic(v_order_id, 'completed', null, '/test');

  select current_quantity into v_quantity
  from public.inventory_items
  where ingredient_id = v_ingredient_id;

  select count(*) into v_count
  from public.inventory_movements
  where order_id = v_order_id and movement_type = 'sale';

  if v_quantity <> 6 or v_count <> 1 then
    raise exception 'Repeated completed status deducted inventory twice.';
  end if;

  select result.order_id
  into v_second_order_id
  from public.create_site_order(
    v_customer_id,
    'pickup',
    null,
    null,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 4)),
    gen_random_uuid(),
    true,
    true,
    false,
    'test',
    '/test',
    'test'
  ) result;

  begin
    perform public.set_order_status_atomic(v_second_order_id, 'completed', null, '/test');
  exception
    when sqlstate 'P0001' then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'Insufficient inventory did not reject completed status.';
  end if;

  select current_quantity into v_quantity
  from public.inventory_items
  where ingredient_id = v_ingredient_id;

  if v_quantity <> 6 then
    raise exception 'Failed completion changed inventory.';
  end if;

  if has_table_privilege('anon', 'public.inventory_items', 'select')
    or has_table_privilege('anon', 'public.inventory_items', 'insert')
    or has_table_privilege('authenticated', 'public.economics_settings', 'select')
    or has_table_privilege('authenticated', 'public.economics_settings', 'update')
  then
    raise exception 'Internal table privileges are still exposed.';
  end if;

  delete from public.inventory_movements
  where order_id in (v_order_id, v_second_order_id);

  delete from public.audit_logs
  where source_path = '/test';

  delete from public.legal_consents
  where subject_type = 'customer'
    and subject_id = v_customer_id
    and document_version = 'test';

  delete from public.orders
  where id in (v_order_id, v_second_order_id);

  delete from public.inventory_items
  where ingredient_id = v_ingredient_id;

  delete from public.product_ingredients
  where product_id = v_product_id;

  delete from public.ingredients
  where id = v_ingredient_id;

  delete from public.products
  where id = v_product_id;

  delete from public.customers
  where id = v_customer_id;
end
$test$;
