-- Operational boundary, test-safe KDS orders and structured product modifiers.
-- Existing orders remain untouched business records and are not reclassified.

alter table public.orders add column if not exists is_operational boolean not null default false;
alter table public.orders add column if not exists operational_started_at timestamptz;
alter table public.orders add column if not exists is_test boolean not null default false;

alter table public.order_items add column if not exists item_note text;
alter table public.order_items add column if not exists configuration_snapshot jsonb not null default '{}'::jsonb;

create index if not exists orders_operational_queue_idx
  on public.orders (location_id, kitchen_status, operational_started_at, created_at)
  where is_operational and kitchen_status in ('new', 'accepted', 'cooking', 'ready');
create index if not exists orders_test_created_idx
  on public.orders (is_test, created_at desc)
  where is_test;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_note_length_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_note_length_check
      check (item_note is null or char_length(item_note) <= 300) not valid;
  end if;
end
$$;

create table if not exists public.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  selection_type text not null default 'multi',
  min_selections integer not null default 0,
  max_selections integer not null default 1,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  constraint product_modifier_groups_selection_check
    check (selection_type in ('single', 'multi')),
  constraint product_modifier_groups_limits_check
    check (
      min_selections >= 0
      and max_selections between 1 and 20
      and min_selections <= max_selections
      and (selection_type <> 'single' or max_selections = 1)
    )
);

create table if not exists public.product_modifier_options (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  group_id uuid not null references public.product_modifier_groups(id) on delete cascade,
  label text not null,
  modifier_type text not null,
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  replacement_ingredient_id uuid references public.ingredients(id) on delete restrict,
  quantity_delta numeric not null default 0,
  unit text not null default 'g',
  price_delta numeric not null default 0,
  kitchen_note text,
  is_default boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  constraint product_modifier_options_type_check
    check (modifier_type in ('remove', 'add', 'replace')),
  constraint product_modifier_options_values_check
    check (
      quantity_delta >= 0
      and price_delta >= 0
      and unit in ('g', 'ml', 'pcs')
      and char_length(label) between 1 and 120
      and (kitchen_note is null or char_length(kitchen_note) <= 300)
      and (
        (modifier_type = 'remove' and ingredient_id is not null)
        or (modifier_type = 'add' and ingredient_id is not null and quantity_delta > 0)
        or (
          modifier_type = 'replace'
          and ingredient_id is not null
          and replacement_ingredient_id is not null
          and quantity_delta > 0
        )
      )
    )
);

create index if not exists product_modifier_groups_product_idx
  on public.product_modifier_groups (product_id, is_active, sort_order, id);
create index if not exists product_modifier_options_group_idx
  on public.product_modifier_options (group_id, is_active, sort_order, id);
create index if not exists product_modifier_options_ingredient_idx
  on public.product_modifier_options (ingredient_id)
  where ingredient_id is not null;

drop trigger if exists product_modifier_groups_set_updated_at on public.product_modifier_groups;
create trigger product_modifier_groups_set_updated_at
before update on public.product_modifier_groups
for each row execute function public.set_updated_at();

drop trigger if exists product_modifier_options_set_updated_at on public.product_modifier_options;
create trigger product_modifier_options_set_updated_at
before update on public.product_modifier_options
for each row execute function public.set_updated_at();

alter table public.order_item_modifiers add column if not exists modifier_group_id uuid;
alter table public.order_item_modifiers add column if not exists modifier_option_id uuid;
alter table public.order_item_modifiers add column if not exists replacement_ingredient_id uuid;
alter table public.order_item_modifiers add column if not exists label text;
alter table public.order_item_modifiers add column if not exists kitchen_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_group_fk'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers
      add constraint order_item_modifiers_group_fk
      foreign key (modifier_group_id) references public.product_modifier_groups(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_option_fk'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers
      add constraint order_item_modifiers_option_fk
      foreign key (modifier_option_id) references public.product_modifier_options(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_replacement_ingredient_fk'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers
      add constraint order_item_modifiers_replacement_ingredient_fk
      foreign key (replacement_ingredient_id) references public.ingredients(id) on delete set null;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'order_item_modifiers_type_check'
      and conrelid = 'public.order_item_modifiers'::regclass
  ) then
    alter table public.order_item_modifiers drop constraint order_item_modifiers_type_check;
  end if;
  alter table public.order_item_modifiers
    add constraint order_item_modifiers_type_check
    check (modifier_type in ('remove', 'add', 'replace')) not valid;
end
$$;

create index if not exists order_item_modifiers_option_idx
  on public.order_item_modifiers (modifier_option_id)
  where modifier_option_id is not null;

create or replace function public.populate_order_items_atomic(
  p_order_id uuid,
  p_items jsonb
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_removed jsonb;
  v_extras jsonb;
  v_selected_options jsonb;
  v_item_note text;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_order_item_id uuid;
  v_quantity integer;
  v_total_quantity integer := 0;
  v_total numeric := 0;
  v_extra_total numeric;
  v_group_total numeric;
  v_line_unit_price numeric;
  v_has_composition boolean;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 50
  then
    raise exception using errcode = 'P0001', message = 'Корзина пуста или содержит слишком много позиций.';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select (item->>'product_id')::uuid
    from jsonb_array_elements(p_items) item
  )
  order by p.id
  for share;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception using errcode = 'P0001', message = 'Некорректная позиция заказа.';
    end;

    if v_quantity < 1 or v_quantity > 20 then
      raise exception using errcode = 'P0001', message = 'Количество одной позиции должно быть от 1 до 20.';
    end if;
    v_total_quantity := v_total_quantity + v_quantity;
    if v_total_quantity > 50 then
      raise exception using errcode = 'P0001', message = 'В заказе может быть не более 50 товаров.';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id and is_active = true;
    if not found then
      raise exception using errcode = 'P0001', message = 'Один из товаров недоступен или удалён.';
    end if;

    v_removed := coalesce(v_item->'removed_ingredient_ids', '[]'::jsonb);
    v_extras := coalesce(v_item->'extras', '[]'::jsonb);
    v_selected_options := coalesce(v_item->'modifier_option_ids', '[]'::jsonb);
    v_item_note := nullif(left(btrim(coalesce(v_item->>'note', '')), 300), '');

    if jsonb_typeof(v_removed) <> 'array'
      or jsonb_typeof(v_extras) <> 'array'
      or jsonb_typeof(v_selected_options) <> 'array'
    then
      raise exception using errcode = 'P0001', message = 'Некорректные изменения состава.';
    end if;
    if jsonb_array_length(v_removed) > 20
      or jsonb_array_length(v_extras) > 20
      or jsonb_array_length(v_selected_options) > 20
    then
      raise exception using errcode = 'P0001', message = 'Слишком много изменений состава.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_selected_options) selected(option_id)
      where selected.option_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
      raise exception using errcode = 'P0001', message = 'Некорректный модификатор.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_removed) x(ingredient_id)
      left join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id::uuid
       and pi.is_removable = true
      where pi.id is null
    ) then
      raise exception using errcode = 'P0001', message = 'Один из ингредиентов нельзя убрать.';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
      left join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id
       and pi.is_extra_available = true
      where pi.id is null
        or x.quantity is null
        or x.quantity < 1
        or x.quantity > pi.max_extra_quantity
    ) then
      raise exception using errcode = 'P0001', message = 'Одна из добавок недоступна или превышен лимит.';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
      join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = x.ingredient_id
      group by x.ingredient_id, pi.max_extra_quantity
      having sum(x.quantity) > pi.max_extra_quantity
    ) then
      raise exception using errcode = 'P0001', message = 'Превышен лимит добавки.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_removed) removed(ingredient_id)
      join jsonb_to_recordset(v_extras) extra(ingredient_id uuid, quantity integer)
        on extra.ingredient_id = removed.ingredient_id::uuid
    ) then
      raise exception using errcode = 'P0001', message = 'Нельзя одновременно убрать и добавить один ингредиент.';
    end if;

    if (
      select count(*) from jsonb_array_elements_text(v_selected_options)
    ) <> (
      select count(distinct option_id) from jsonb_array_elements_text(v_selected_options) selected(option_id)
    ) then
      raise exception using errcode = 'P0001', message = 'Модификатор выбран повторно.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_selected_options) selected(option_id)
      left join public.product_modifier_options option_row
        on option_row.id = selected.option_id::uuid
       and option_row.is_active = true
      left join public.product_modifier_groups group_row
        on group_row.id = option_row.group_id
       and group_row.product_id = v_product_id
       and group_row.is_active = true
      where option_row.id is null or group_row.id is null
    ) then
      raise exception using errcode = 'P0001', message = 'Один из модификаторов недоступен.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_selected_options) selected(option_id)
      join public.product_modifier_options option_row
        on option_row.id = selected.option_id::uuid
       and option_row.modifier_type in ('remove', 'replace')
      left join public.product_ingredients pi
        on pi.product_id = v_product_id
       and pi.ingredient_id = option_row.ingredient_id
       and pi.is_removable = true
      where pi.id is null
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Этот ингредиент нельзя убрать или заменить.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_selected_options) selected(option_id)
      join public.product_modifier_options option_row
        on option_row.id = selected.option_id::uuid
       and option_row.modifier_type in ('remove', 'replace')
      left join lateral (
        select true as conflict
        from jsonb_array_elements_text(v_removed) removed(ingredient_id)
        where removed.ingredient_id::uuid = option_row.ingredient_id
        union all
        select true
        from jsonb_to_recordset(v_extras) extra(ingredient_id uuid, quantity integer)
        where extra.ingredient_id = option_row.ingredient_id
        limit 1
      ) duplicate_change on true
      where duplicate_change.conflict
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Ингредиент изменён несколькими несовместимыми способами.';
    end if;

    if exists (
      select 1
      from public.product_modifier_groups group_row
      left join lateral (
        select count(distinct selected.option_id)::integer as selected_count
        from jsonb_array_elements_text(v_selected_options) selected(option_id)
        join public.product_modifier_options option_row
          on option_row.id = selected.option_id::uuid
         and option_row.group_id = group_row.id
         and option_row.is_active = true
      ) selection on true
      where group_row.product_id = v_product_id
        and group_row.is_active = true
        and (
          coalesce(selection.selected_count, 0) < group_row.min_selections
          or coalesce(selection.selected_count, 0) > group_row.max_selections
        )
    ) then
      raise exception using errcode = 'P0001', message = 'Проверьте обязательные группы модификаторов.';
    end if;

    select coalesce(sum(pi.extra_price * x.quantity), 0)
    into v_extra_total
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true;

    select coalesce(sum(option_row.price_delta), 0)
    into v_group_total
    from jsonb_array_elements_text(v_selected_options) selected(option_id)
    join public.product_modifier_options option_row
      on option_row.id = selected.option_id::uuid
     and option_row.is_active = true;

    v_line_unit_price := v_product.price + v_extra_total + v_group_total;

    select exists (
      select 1 from public.product_ingredients pi
      where pi.product_id = v_product_id and pi.quantity > 0
    ) into v_has_composition;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity,
      line_total, inventory_snapshot_ready, item_note, configuration_snapshot
    ) values (
      p_order_id, v_product.id, v_product.name, v_line_unit_price, v_quantity,
      v_line_unit_price * v_quantity, v_has_composition, v_item_note,
      jsonb_build_object(
        'removed_ingredient_ids', v_removed,
        'extras', v_extras,
        'modifier_option_ids', v_selected_options
      )
    ) returning id into v_order_item_id;

    insert into public.order_item_modifiers (
      order_item_id, ingredient_id, modifier_type, ingredient_name,
      quantity, unit, unit_price_delta, line_price_delta, label
    )
    select v_order_item_id, pi.ingredient_id, 'remove', i.name,
      pi.quantity, pi.unit, 0, 0, 'Без ' || i.name
    from jsonb_array_elements_text(v_removed) x(ingredient_id)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id::uuid
     and pi.is_removable = true
    join public.ingredients i on i.id = pi.ingredient_id;

    insert into public.order_item_modifiers (
      order_item_id, ingredient_id, modifier_type, ingredient_name,
      quantity, unit, unit_price_delta, line_price_delta, label
    )
    select v_order_item_id, pi.ingredient_id, 'add', i.name,
      pi.extra_quantity * sum(x.quantity), pi.unit,
      pi.extra_price * sum(x.quantity),
      pi.extra_price * sum(x.quantity) * v_quantity,
      '+ ' || i.name
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true
    join public.ingredients i on i.id = pi.ingredient_id
    group by pi.ingredient_id, i.name, pi.extra_quantity, pi.unit, pi.extra_price;

    insert into public.order_item_modifiers (
      order_item_id, ingredient_id, replacement_ingredient_id,
      modifier_group_id, modifier_option_id, modifier_type,
      ingredient_name, quantity, unit, unit_price_delta,
      line_price_delta, label, kitchen_note
    )
    select
      v_order_item_id,
      option_row.ingredient_id,
      option_row.replacement_ingredient_id,
      group_row.id,
      option_row.id,
      option_row.modifier_type,
      option_row.label,
      case
        when option_row.modifier_type = 'remove'
          then coalesce(nullif(option_row.quantity_delta, 0), pi.quantity, 0)
        else option_row.quantity_delta
      end,
      option_row.unit,
      option_row.price_delta,
      option_row.price_delta * v_quantity,
      option_row.label,
      option_row.kitchen_note
    from jsonb_array_elements_text(v_selected_options) selected(option_id)
    join public.product_modifier_options option_row
      on option_row.id = selected.option_id::uuid
     and option_row.is_active = true
    join public.product_modifier_groups group_row
      on group_row.id = option_row.group_id
     and group_row.product_id = v_product_id
     and group_row.is_active = true
    left join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = option_row.ingredient_id;

    insert into public.order_item_ingredient_usage (
      order_item_id, ingredient_id, ingredient_name, quantity_per_item, unit
    )
    select v_order_item_id, pi.ingredient_id, i.name, pi.quantity, pi.unit
    from public.product_ingredients pi
    join public.ingredients i on i.id = pi.ingredient_id
    where pi.product_id = v_product_id
      and pi.quantity > 0
      and not exists (
        select 1
        from jsonb_array_elements_text(v_removed) x(ingredient_id)
        where x.ingredient_id::uuid = pi.ingredient_id
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(v_selected_options) selected(option_id)
        join public.product_modifier_options option_row
          on option_row.id = selected.option_id::uuid
        where option_row.modifier_type in ('remove', 'replace')
          and option_row.ingredient_id = pi.ingredient_id
      );

    insert into public.order_item_ingredient_usage (
      order_item_id, ingredient_id, ingredient_name, quantity_per_item, unit
    )
    select v_order_item_id, pi.ingredient_id, i.name,
      pi.extra_quantity * sum(x.quantity), pi.unit
    from jsonb_to_recordset(v_extras) x(ingredient_id uuid, quantity integer)
    join public.product_ingredients pi
      on pi.product_id = v_product_id
     and pi.ingredient_id = x.ingredient_id
     and pi.is_extra_available = true
    join public.ingredients i on i.id = pi.ingredient_id
    group by pi.ingredient_id, i.name, pi.extra_quantity, pi.unit
    on conflict (order_item_id, ingredient_id)
    do update set quantity_per_item =
      public.order_item_ingredient_usage.quantity_per_item
      + excluded.quantity_per_item;

    insert into public.order_item_ingredient_usage (
      order_item_id, ingredient_id, ingredient_name, quantity_per_item, unit
    )
    select
      v_order_item_id,
      case
        when option_row.modifier_type = 'replace' then option_row.replacement_ingredient_id
        else option_row.ingredient_id
      end,
      ingredient.name,
      sum(option_row.quantity_delta),
      option_row.unit
    from jsonb_array_elements_text(v_selected_options) selected(option_id)
    join public.product_modifier_options option_row
      on option_row.id = selected.option_id::uuid
     and option_row.modifier_type in ('add', 'replace')
     and option_row.is_active = true
    join public.ingredients ingredient
      on ingredient.id = case
        when option_row.modifier_type = 'replace' then option_row.replacement_ingredient_id
        else option_row.ingredient_id
      end
    group by
      case
        when option_row.modifier_type = 'replace' then option_row.replacement_ingredient_id
        else option_row.ingredient_id
      end,
      ingredient.name,
      option_row.unit
    on conflict (order_item_id, ingredient_id)
    do update set quantity_per_item =
      public.order_item_ingredient_usage.quantity_per_item
      + excluded.quantity_per_item;

    v_total := v_total + v_line_unit_price * v_quantity;
  end loop;

  return v_total;
end
$$;

-- New overloads preserve the previous RPCs for rollback while marking every
-- order created by the current application as operational.
create or replace function public.create_site_order(
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
  p_is_test boolean
)
returns table(order_id uuid, total numeric)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result record;
begin
  select * into v_result
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
    p_requested_at
  );

  update public.orders
  set is_operational = true,
      operational_started_at = coalesce(operational_started_at, created_at, now()),
      is_test = p_is_test,
      source_metadata = coalesce(source_metadata, '{}'::jsonb)
        || jsonb_build_object('test_order', p_is_test),
      updated_at = now()
  where id = v_result.order_id;

  return query select v_result.order_id::uuid, v_result.total::numeric;
end
$$;

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
  p_is_test boolean
)
returns table(order_id uuid, total numeric, display_number text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result record;
begin
  select * into v_result
  from public.create_pos_order_atomic(
    p_location_id,
    p_customer_name,
    p_comment,
    p_items,
    p_idempotency_key,
    p_actor_id,
    p_actor_role,
    p_fulfillment_mode,
    p_requested_at
  );

  update public.orders
  set is_operational = true,
      operational_started_at = coalesce(operational_started_at, created_at, now()),
      is_test = p_is_test,
      source_metadata = coalesce(source_metadata, '{}'::jsonb)
        || jsonb_build_object('test_order', p_is_test),
      updated_at = now()
  where id = v_result.order_id;

  return query
  select v_result.order_id::uuid, v_result.total::numeric, v_result.display_number::text;
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
  s.source_metadata
from public.analytics_sales s
left join public.orders o
  on s.sale_id = 'web:' || o.id::text
left join public.order_locations l on l.id = o.location_id
where o.id is null or not o.is_test;

alter table public.product_modifier_groups enable row level security;
alter table public.product_modifier_options enable row level security;

revoke all privileges on table public.product_modifier_groups from public;
revoke all privileges on table public.product_modifier_options from public;
revoke all on function public.create_site_order(
  uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
  text, text, text, text, timestamptz, boolean
) from public;
revoke all on function public.create_pos_order_atomic(
  uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz, boolean
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table
      public.product_modifier_groups,
      public.product_modifier_options
    to karimoff_app;

    drop policy if exists product_modifier_groups_app_all on public.product_modifier_groups;
    create policy product_modifier_groups_app_all
      on public.product_modifier_groups for all to karimoff_app
      using (true) with check (true);
    drop policy if exists product_modifier_options_app_all on public.product_modifier_options;
    create policy product_modifier_options_app_all
      on public.product_modifier_options for all to karimoff_app
      using (true) with check (true);

    grant execute on function public.create_site_order(
      uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean,
      text, text, text, text, timestamptz, boolean
    ) to karimoff_app;
    grant execute on function public.create_pos_order_atomic(
      uuid, text, text, jsonb, uuid, uuid, text, text, timestamptz, boolean
    ) to karimoff_app;
  end if;
end
$$;
