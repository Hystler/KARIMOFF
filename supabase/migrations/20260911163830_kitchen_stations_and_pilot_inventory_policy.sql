-- Pilot inventory policy and independent kitchen stations. No payment/fiscal rules changed.
-- Revert behavior per location with kitchen_sla_settings.inventory_shortage_policy = 'block'.
alter table public.kitchen_sla_settings
  add column if not exists inventory_shortage_policy text not null default 'allow_negative'
  check (inventory_shortage_policy in ('allow_negative', 'block'));

-- Actual consumption is kept in balances and sale movements, including deficits.
-- Strict order mode and existing production/manual-writeoff guards still reject shortages.
alter table public.inventory_items drop constraint if exists inventory_items_nonnegative_check;
alter table public.inventory_items add constraint inventory_items_nonnegative_check
  check (reserved_quantity >= 0 and min_quantity >= 0) not valid;

-- Paid order_items are immutable; kitchen progress belongs in a separate relation.
create table if not exists public.order_item_kitchen_state (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  station text not null,
  status text not null default 'new' check (status in ('new', 'cooking', 'ready')),
  cooking_started_at timestamptz,
  ready_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.order_item_kitchen_state drop constraint if exists order_item_kitchen_state_station_check;
alter table public.order_item_kitchen_state add constraint order_item_kitchen_state_station_check
  check (station in ('snacks', 'main'));
alter table public.order_item_kitchen_state enable row level security;
revoke all on table public.order_item_kitchen_state from public, anon, authenticated;

create or replace function public.kitchen_station_for_category(p_category text)
returns text language sql immutable security invoker set search_path = public, pg_temp
as $$
  select case
    when lower(coalesce(p_category, '')) ~ '(бургер|burger|шаур|shaur|shawarma|ролл|roll|хот.?дог|hot.?dog)' then 'main'
    else 'snacks'
  end
$$;

create or replace function public.initialize_order_item_kitchen_state()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  insert into public.order_item_kitchen_state (order_item_id, station)
  values (new.id, public.kitchen_station_for_category((select category from public.products where id = new.product_id)))
  on conflict (order_item_id) do nothing;
  return new;
end
$$;
drop trigger if exists order_items_initialize_kitchen_state on public.order_items;
create trigger order_items_initialize_kitchen_state after insert on public.order_items
for each row execute function public.initialize_order_item_kitchen_state();

create or replace function public.set_order_kitchen_station_status_atomic(
  p_order_id uuid, p_station text, p_status text,
  p_actor_id uuid default null, p_actor_role text default 'admin', p_device_source text default 'kds'
)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_changed integer;
  v_remaining integer;
  v_result jsonb := jsonb_build_object('ok', true, 'warnings', '[]'::jsonb);
begin
  if coalesce(p_station, '') not in ('snacks', 'main')
    or coalesce(p_status, '') not in ('cooking', 'ready') then
    raise exception using errcode = 'P0001', message = 'Некорректное действие станции.';
  end if;
  if coalesce(p_actor_role, '') not in ('owner', 'admin', 'manager', 'cook') then
    raise exception using errcode = 'P0001', message = 'Недостаточно прав для работы станции.';
  end if;

  -- Serialize both stations on the parent row before inspecting or writing line progress.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not v_order.is_operational or v_order.kitchen_status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'Заказ недоступен для кухни.';
  end if;

  -- Adopt legacy active orders without changing their immutable commercial lines.
  insert into public.order_item_kitchen_state (order_item_id, station, status)
  select item.id, public.kitchen_station_for_category(product.category),
    case when v_order.kitchen_status in ('ready', 'handed_out') then 'ready'
      when v_order.kitchen_status = 'cooking' then 'cooking' else 'new' end
  from public.order_items item
  left join public.products product on product.id = item.product_id
  where item.order_id = p_order_id
  on conflict (order_item_id) do nothing;

  if not exists (
    select 1 from public.order_item_kitchen_state work
    join public.order_items item on item.id = work.order_item_id
    where item.order_id = p_order_id and work.station = p_station
  ) then
    raise exception using errcode = 'P0001', message = 'В заказе нет позиций этой станции.';
  end if;

  if not exists (
    select 1 from public.order_item_kitchen_state work
    join public.order_items item on item.id = work.order_item_id
    where item.order_id = p_order_id and work.station = p_station
      and case when p_status = 'cooking' then work.status = 'new' else work.status <> 'ready' end
  ) then
    return v_result || jsonb_build_object('already_applied', true);
  end if;
  if v_order.kitchen_status in ('ready', 'handed_out') then
    raise exception using errcode = 'P0001', message = 'Заказ уже готов.';
  end if;

  if p_status = 'cooking' then
    if v_order.kitchen_status = 'new' then
      perform public.set_order_kitchen_status_atomic(p_order_id, 'accepted', p_actor_id, p_actor_role, p_device_source);
    end if;
    if v_order.kitchen_status in ('new', 'accepted') then
      perform public.set_order_kitchen_status_atomic(p_order_id, 'cooking', p_actor_id, p_actor_role, p_device_source);
    end if;
  elsif exists (
    select 1 from public.order_item_kitchen_state work
    join public.order_items item on item.id = work.order_item_id
    where item.order_id = p_order_id and work.station = p_station and work.status = 'new'
  ) then
    raise exception using errcode = 'P0001', message = 'Сначала начните готовить на этой станции.';
  end if;

  update public.order_item_kitchen_state work
  set status = p_status, updated_at = now(),
      cooking_started_at = coalesce(work.cooking_started_at, now()),
      ready_at = case when p_status = 'ready' then coalesce(work.ready_at, now()) else work.ready_at end
  from public.order_items item
  where item.id = work.order_item_id and item.order_id = p_order_id and work.station = p_station
    and case when p_status = 'cooking' then work.status = 'new' else work.status = 'cooking' end;
  get diagnostics v_changed = row_count;

  select count(*) into v_remaining from public.order_item_kitchen_state work
  join public.order_items item on item.id = work.order_item_id
  where item.order_id = p_order_id and work.status <> 'ready';
  if p_status = 'ready' and v_remaining = 0 then
    v_result := public.set_order_kitchen_status_atomic(p_order_id, 'ready', p_actor_id, p_actor_role, p_device_source);
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, source_path)
  values ('staff', p_actor_id, 'order.station_change', 'order', p_order_id::text,
    jsonb_build_object('station', p_station, 'to', p_status, 'lines_changed', v_changed, 'remaining_lines', v_remaining), p_device_source);
  insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
  values (p_order_id, 'order.station_changed',
    jsonb_build_object('order_id', p_order_id, 'location_id', v_order.location_id,
      'station', p_station, 'to', p_status, 'is_test', v_order.is_test),
    'order:' || p_order_id || ':station:' || p_station || ':' || p_status)
  on conflict (idempotency_key) do nothing;
  return v_result || jsonb_build_object('remaining_lines', v_remaining);
end
$$;

revoke all on function public.kitchen_station_for_category(text) from public, anon, authenticated;
revoke all on function public.initialize_order_item_kitchen_state() from public, anon, authenticated;
revoke all on function public.set_order_kitchen_station_status_atomic(uuid, text, text, uuid, text, text) from public, anon, authenticated;

do $$
declare v_role text;
begin
  foreach v_role in array array['karimoff_app', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant select, insert, update on public.order_item_kitchen_state to %I', v_role);
      execute format('drop policy if exists kitchen_state_%I on public.order_item_kitchen_state', v_role);
      execute format('create policy kitchen_state_%I on public.order_item_kitchen_state for all to %I using (true) with check (true)', v_role, v_role);
      execute format('grant execute on function public.kitchen_station_for_category(text), public.initialize_order_item_kitchen_state(), public.set_order_kitchen_station_status_atomic(uuid,text,text,uuid,text,text) to %I', v_role);
    end if;
  end loop;
end
$$;

create or replace function public.set_order_status_staff_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid default null,
  p_actor_role text default 'admin',
  p_source_path text default '/admin/orders'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_warnings jsonb := '[]'::jsonb;
  v_deficits text;
  v_shortage_policy text;
  v_points numeric;
  v_loyalty_percent numeric;
  v_loyalty_enabled boolean;
  v_loyalty_joined boolean;
  v_earned_inserted integer := 0;
  v_reverse_points numeric;
  v_inventory_already_deducted boolean := false;
begin
  if p_status not in ('new', 'in_progress', 'completed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус заказа.';
  end if;

  if p_actor_role not in ('admin', 'manager', 'cook') then
    raise exception using errcode = 'P0001', message = 'Некорректная роль сотрудника.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ не найден.';
  end if;

  if p_actor_role = 'cook'
    and not (
      (v_order.status = 'new' and p_status = 'in_progress')
      or (v_order.status = 'in_progress' and p_status = 'completed')
      or v_order.status = p_status
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'Повар может только принять новый заказ в работу или отметить готовящуюся позицию выполненной.';
  end if;

  if v_order.status = p_status then
    return jsonb_build_object('ok', true, 'already_applied', true, 'warnings', v_warnings);
  end if;

  if p_status = 'completed' then
    select exists (
      select 1
      from public.order_inventory_deductions oid
      where oid.order_id = p_order_id
    )
    into v_inventory_already_deducted;

    if v_order.status = 'cancelled' and v_inventory_already_deducted then
      raise exception using
        errcode = 'P0001',
        message = 'Нельзя повторно завершить отменённый заказ, по которому уже был списан склад.';
    end if;

    select coalesce(
      jsonb_agg(format('У товара не задан состав, склад не списан: %s', oi.product_name)),
      '[]'::jsonb
    )
    into v_warnings
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.inventory_snapshot_ready = false
      and (
        oi.product_id is null
        or not exists (
          select 1
          from public.product_ingredients pi
          where pi.product_id = oi.product_id and pi.quantity > 0
        )
      );

    if not v_inventory_already_deducted then
      select coalesce((
        select inventory_shortage_policy from public.kitchen_sla_settings
        where location_id = v_order.location_id
      ), 'allow_negative') into v_shortage_policy;

      -- Materialize missing balances before locking so every sale movement has a balance.
      insert into public.inventory_items (ingredient_id, unit)
      select ingredient_id, unit from public.get_order_inventory_requirements(p_order_id)
      order by ingredient_id
      on conflict (ingredient_id) do nothing;
      perform 1
      from public.inventory_items ii
      where ii.ingredient_id in (
        select requirements.ingredient_id
        from public.get_order_inventory_requirements(p_order_id) requirements
      )
      order by ii.ingredient_id
      for update;

      select string_agg(
        format(
          '%s: нужно %s %s, доступно %s %s',
          i.name,
          requirements.required_quantity,
          requirements.unit,
          coalesce(ii.current_quantity, 0),
          requirements.unit
        ),
        '; '
      )
      into v_deficits
      from public.get_order_inventory_requirements(p_order_id) requirements
      join public.ingredients i on i.id = requirements.ingredient_id
      left join public.inventory_items ii on ii.ingredient_id = requirements.ingredient_id
      where coalesce(ii.current_quantity, 0) < requirements.required_quantity;

      if v_deficits is not null then
        if v_shortage_policy = 'block' then
          raise exception using
            errcode = 'P0001',
            message = 'Недостаточно остатков: ' || v_deficits;
        end if;
        v_warnings := v_warnings || jsonb_build_array(
          'Пилот: склад списан с дефицитом. ' || v_deficits
        );
      end if;

      update public.inventory_items ii
      set current_quantity = ii.current_quantity - requirements.required_quantity,
          updated_at = now()
      from public.get_order_inventory_requirements(p_order_id) requirements
      where ii.ingredient_id = requirements.ingredient_id;

      insert into public.inventory_movements (
        ingredient_id,
        order_id,
        product_id,
        movement_type,
        quantity,
        unit,
        reason,
        comment,
        created_by
      )
      select
        requirements.ingredient_id,
        p_order_id,
        null,
        'sale',
        -requirements.required_quantity,
        requirements.unit,
        'Автосписание по заказу',
        'Фактический состав заказа с учётом модификаций',
        'system'
      from public.get_order_inventory_requirements(p_order_id) requirements;

      insert into public.order_inventory_deductions (order_id, status)
      values (p_order_id, 'deducted');
    else
      v_warnings := v_warnings || jsonb_build_array(
        'Склад по этому заказу уже был списан повторно и не изменён.'
      );
    end if;

    select loyalty_enabled, loyalty_percent
    into v_loyalty_enabled, v_loyalty_percent
    from public.site_settings
    where id = 'main';

    select coalesce((
      select lc.granted
      from public.legal_consents lc
      where lc.subject_type = 'customer'
        and lc.subject_id = v_order.customer_id
        and lc.consent_type = 'loyalty_rules'
      order by lc.created_at desc
      limit 1
    ), false)
    into v_loyalty_joined;

    if coalesce(v_loyalty_enabled, true)
      and v_loyalty_joined
      and v_order.customer_id is not null
      and v_order.payment_status in ('paid', 'not_required')
    then
      v_points := round(greatest(0, v_order.total) * coalesce(v_loyalty_percent, 10) / 100, 2);

      if v_points > 0 then
        insert into public.loyalty_accounts (customer_id)
        values (v_order.customer_id)
        on conflict (customer_id) do nothing;

        insert into public.loyalty_transactions (
          customer_id,
          order_id,
          type,
          points,
          description,
          idempotency_key
        )
        values (
          v_order.customer_id,
          p_order_id,
          'earn',
          v_points,
          'Начисление за выполненный заказ ' || p_order_id,
          'order:' || p_order_id || ':earn'
        )
        on conflict (idempotency_key) do nothing;

        get diagnostics v_earned_inserted = row_count;

        if v_earned_inserted = 1 then
          update public.loyalty_accounts
          set points_balance = points_balance + v_points,
              total_earned = total_earned + v_points,
              updated_at = now()
          where customer_id = v_order.customer_id;
        end if;
      end if;
    end if;
  elsif p_status = 'cancelled'
    and v_order.status = 'completed'
    and v_order.customer_id is not null
  then
    select coalesce(sum(points), 0)
    into v_reverse_points
    from public.loyalty_transactions
    where order_id = p_order_id and type = 'earn';

    if v_reverse_points > 0 then
      insert into public.loyalty_transactions (
        customer_id,
        order_id,
        type,
        points,
        description,
        idempotency_key
      )
      values (
        v_order.customer_id,
        p_order_id,
        'adjust',
        -v_reverse_points,
        'Корректировка бонусов при отмене/возврате заказа ' || p_order_id,
        'order:' || p_order_id || ':reverse'
      )
      on conflict (idempotency_key) do nothing;

      get diagnostics v_earned_inserted = row_count;

      if v_earned_inserted = 1 then
        update public.loyalty_accounts
        set points_balance = points_balance - v_reverse_points,
            total_spent = total_spent + v_reverse_points,
            updated_at = now()
        where customer_id = v_order.customer_id;
      end if;
    end if;

    v_warnings := v_warnings || jsonb_build_array(
      'Автоматический возврат ингредиентов на склад пока не выполняется; при необходимости оформите движение «Возврат».'
    );
  end if;

  update public.orders
  set
    status = p_status,
    updated_at = now(),
    assigned_staff_id = case
      when p_actor_id is not null and p_status in ('in_progress', 'completed')
        then coalesce(assigned_staff_id, p_actor_id)
      else assigned_staff_id
    end,
    kitchen_started_at = case
      when p_status = 'in_progress' then coalesce(kitchen_started_at, now())
      else kitchen_started_at
    end,
    kitchen_completed_at = case
      when p_status = 'completed' then coalesce(kitchen_completed_at, now())
      else kitchen_completed_at
    end
  where id = p_order_id;

  insert into public.audit_logs (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    source_path
  )
  values (
    'staff',
    p_actor_id,
    'order.status_change',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'from', v_order.status,
      'to', p_status,
      'role', p_actor_role,
      'warnings', v_warnings,
      'inventory_shortage_policy', v_shortage_policy,
      'inventory_deficits', v_deficits
    ),
    p_source_path
  );

  return jsonb_build_object('ok', true, 'warnings', v_warnings);
end
$$;

create or replace function public.set_order_kitchen_status_atomic(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid default null,
  p_actor_role text default 'admin',
  p_device_source text default 'admin'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_business_status text;
  v_warnings jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_status not in ('new', 'accepted', 'cooking', 'ready', 'handed_out', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'Некорректный статус кухни.';
  end if;
  if p_actor_role not in ('owner', 'admin', 'manager', 'cashier', 'cook') then
    raise exception using errcode = 'P0001', message = 'Некорректная роль сотрудника.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Заказ не найден.';
  end if;
  if not v_order.is_operational then
    raise exception using errcode = 'P0001', message = 'Исторический заказ недоступен в рабочей очереди.';
  end if;
  if v_order.kitchen_status = p_status then
    return jsonb_build_object('ok', true, 'already_applied', true, 'warnings', v_warnings);
  end if;

  if p_status = 'cancelled' and v_order.kitchen_status in ('ready', 'handed_out') then
    raise exception using
      errcode = 'P0001',
      message = 'Готовый заказ нельзя отменить без оформления возврата и обратного движения склада.';
  end if;

  if p_actor_role = 'cook' and not (
    (v_order.kitchen_status = 'new' and p_status = 'accepted')
    or (v_order.kitchen_status = 'accepted' and p_status = 'cooking')
    or (v_order.kitchen_status = 'cooking' and p_status = 'ready')
  ) then
    raise exception using errcode = 'P0001', message = 'Этот переход недоступен для роли повара.';
  end if;
  if p_actor_role = 'cashier' and not (
    v_order.kitchen_status = 'ready' and p_status = 'handed_out'
  ) then
    raise exception using errcode = 'P0001', message = 'Кассир может только отметить выдачу готового заказа.';
  end if;
  if p_status <> 'cancelled' and not (
    (v_order.kitchen_status = 'new' and p_status = 'accepted')
    or (v_order.kitchen_status = 'accepted' and p_status = 'cooking')
    or (v_order.kitchen_status = 'cooking' and p_status = 'ready')
    or (v_order.kitchen_status = 'ready' and p_status = 'handed_out')
  ) then
    raise exception using errcode = 'P0001', message = 'Недопустимый переход статуса заказа.';
  end if;

  -- The legacy whole-order command may finish one station, never unfinished mixed work.
  if p_status = 'ready' and (
    select count(distinct coalesce(work.station, public.kitchen_station_for_category(product.category)))
    from public.order_items item
    left join public.products product on product.id = item.product_id
    left join public.order_item_kitchen_state work on work.order_item_id = item.id
    where item.order_id = p_order_id
  ) > 1 and exists (
    select 1 from public.order_items item
    left join public.order_item_kitchen_state work on work.order_item_id = item.id
    where item.order_id = p_order_id and coalesce(work.status, 'new') <> 'ready'
  ) then
    raise exception using errcode = 'P0001', message = 'Сначала завершите работу каждой станции.';
  end if;

  v_business_status := case
    when p_status = 'new' then 'new'
    when p_status in ('accepted', 'cooking') then 'in_progress'
    when p_status in ('ready', 'handed_out') then 'completed'
    else 'cancelled'
  end;

  if v_order.is_test then
    update public.orders
    set status = v_business_status, updated_at = now()
    where id = p_order_id;
    if p_status = 'ready' then
      v_warnings := jsonb_build_array('Тестовый заказ: склад, бонусы и фискализация не изменены.');
    end if;
  elsif p_status = 'ready' then
    select public.set_order_status_staff_atomic(
      p_order_id,
      'completed',
      p_actor_id,
      case when p_actor_role = 'owner' then 'admin' else p_actor_role end,
      p_device_source
    ) into v_result;
    v_warnings := coalesce(v_result->'warnings', '[]'::jsonb);
  elsif p_status = 'cancelled' then
    select public.set_order_status_staff_atomic(
      p_order_id,
      'cancelled',
      p_actor_id,
      case when p_actor_role = 'owner' then 'admin' else p_actor_role end,
      p_device_source
    ) into v_result;
    v_warnings := coalesce(v_result->'warnings', '[]'::jsonb);
  elsif v_order.status <> v_business_status then
    update public.orders
    set status = v_business_status, updated_at = now()
    where id = p_order_id;
  end if;

  update public.orders
  set kitchen_status = p_status,
      updated_at = now(),
      assigned_staff_id = case
        when p_actor_id is not null and p_status in ('accepted', 'cooking', 'ready')
          then coalesce(assigned_staff_id, p_actor_id)
        else assigned_staff_id
      end,
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      cooking_started_at = case when p_status = 'cooking' then coalesce(cooking_started_at, now()) else cooking_started_at end,
      ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
      handed_out_at = case when p_status = 'handed_out' then coalesce(handed_out_at, now()) else handed_out_at end,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_order_id;

  if p_status = 'ready' then
    insert into public.order_item_kitchen_state (order_item_id, station, status, ready_at)
    select item.id, public.kitchen_station_for_category(product.category), 'ready', now()
    from public.order_items item
    left join public.products product on product.id = item.product_id
    where item.order_id = p_order_id
    on conflict (order_item_id) do update
      set status = 'ready', ready_at = coalesce(order_item_kitchen_state.ready_at, now()), updated_at = now();
  end if;

  insert into public.order_status_events (
    order_id, from_status, to_status, actor_user_id, actor_role,
    device_source, metadata
  ) values (
    p_order_id, v_order.kitchen_status, p_status, p_actor_id, p_actor_role,
    p_device_source, jsonb_build_object('warnings', v_warnings, 'is_test', v_order.is_test)
  );

  insert into public.order_outbox (
    aggregate_id, event_type, payload, idempotency_key
  ) values (
    p_order_id,
    'order.status_changed',
    jsonb_build_object(
      'order_id', p_order_id,
      'location_id', v_order.location_id,
      'from', v_order.kitchen_status,
      'to', p_status,
      'is_test', v_order.is_test
    ),
    'order:' || p_order_id || ':status:' || p_status
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'warnings', v_warnings);
end
$$;
