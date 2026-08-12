create table if not exists public.production_recipes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  output_ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  category text,
  output_quantity numeric not null default 1,
  output_unit text not null default 'kg',
  batch_duration_minutes integer not null default 60,
  planned_batches_per_month numeric not null default 0,
  sale_price_per_output_unit numeric not null default 0,
  notes text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  constraint production_recipes_output_ingredient_key unique (output_ingredient_id),
  constraint production_recipes_output_quantity_check check (output_quantity > 0),
  constraint production_recipes_output_unit_check check (output_unit in ('g', 'kg', 'ml', 'l', 'pcs')),
  constraint production_recipes_duration_check check (batch_duration_minutes > 0),
  constraint production_recipes_plan_check check (planned_batches_per_month >= 0),
  constraint production_recipes_sale_price_check check (sale_price_per_output_unit >= 0)
);

create table if not exists public.production_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.production_recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric not null,
  unit text not null,
  is_primary boolean not null default false,
  sort_order integer not null default 100,
  constraint production_recipe_items_unique unique (recipe_id, ingredient_id),
  constraint production_recipe_items_quantity_check check (quantity > 0),
  constraint production_recipe_items_unit_check check (unit in ('g', 'kg', 'ml', 'l', 'pcs'))
);

create table if not exists public.production_recipe_expenses (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.production_recipes(id) on delete cascade,
  category text not null default 'other',
  name text not null,
  amount_per_batch numeric not null default 0,
  sort_order integer not null default 100,
  constraint production_recipe_expenses_category_check check (
    category in ('labor', 'electricity', 'packaging', 'supplies', 'logistics', 'other')
  ),
  constraint production_recipe_expenses_amount_check check (amount_per_batch >= 0)
);

create table if not exists public.production_overheads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  category text not null default 'other',
  quantity numeric not null default 1,
  amount_per_unit numeric not null default 0,
  comment text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  constraint production_overheads_category_check check (
    category in ('payroll', 'rent', 'utilities', 'sanitation', 'maintenance', 'accounting', 'stationery', 'logistics', 'other')
  ),
  constraint production_overheads_quantity_check check (quantity >= 0),
  constraint production_overheads_amount_check check (amount_per_unit >= 0)
);

create table if not exists public.production_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  recipe_id uuid not null references public.production_recipes(id) on delete restrict,
  run_date date not null default current_date,
  status text not null default 'completed',
  batch_count numeric not null default 1,
  output_quantity numeric not null,
  output_unit text not null,
  material_cost numeric not null default 0,
  direct_cost numeric not null default 0,
  overhead_cost numeric not null default 0,
  total_cost numeric not null default 0,
  cost_per_base_unit numeric not null default 0,
  sale_price_per_output_unit numeric not null default 0,
  planned_revenue numeric not null default 0,
  gross_profit numeric not null default 0,
  gross_margin_percent numeric,
  notes text,
  created_by text not null default 'admin',
  constraint production_runs_status_check check (status in ('completed')),
  constraint production_runs_batch_count_check check (batch_count > 0),
  constraint production_runs_output_quantity_check check (output_quantity > 0),
  constraint production_runs_output_unit_check check (output_unit in ('g', 'kg', 'ml', 'l', 'pcs'))
);

create table if not exists public.production_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.production_runs(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  ingredient_name text not null,
  quantity_base numeric not null,
  unit text not null,
  is_primary boolean not null default false,
  cost_per_unit numeric not null,
  line_cost numeric not null,
  constraint production_run_items_quantity_check check (quantity_base > 0),
  constraint production_run_items_unit_check check (unit in ('g', 'ml', 'pcs'))
);

alter table public.inventory_movements
  add column if not exists production_run_id uuid references public.production_runs(id) on delete set null;

create index if not exists production_recipes_active_sort_idx
  on public.production_recipes (is_active, sort_order, name);
create index if not exists production_recipe_items_recipe_idx
  on public.production_recipe_items (recipe_id, sort_order);
create index if not exists production_recipe_items_ingredient_idx
  on public.production_recipe_items (ingredient_id);
create unique index if not exists production_recipe_items_one_primary_idx
  on public.production_recipe_items (recipe_id)
  where is_primary = true;
create index if not exists production_recipe_expenses_recipe_idx
  on public.production_recipe_expenses (recipe_id, sort_order);
create index if not exists production_overheads_active_sort_idx
  on public.production_overheads (is_active, sort_order, name);
create index if not exists production_runs_recipe_created_idx
  on public.production_runs (recipe_id, created_at desc);
create index if not exists production_runs_created_idx
  on public.production_runs (created_at desc);
create index if not exists production_run_items_run_idx
  on public.production_run_items (run_id);
create index if not exists inventory_movements_production_run_idx
  on public.inventory_movements (production_run_id);

drop trigger if exists production_recipes_set_updated_at on public.production_recipes;
create trigger production_recipes_set_updated_at
before update on public.production_recipes
for each row execute function public.set_updated_at();

drop trigger if exists production_overheads_set_updated_at on public.production_overheads;
create trigger production_overheads_set_updated_at
before update on public.production_overheads
for each row execute function public.set_updated_at();

create or replace function public.production_unit_family(p_unit text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_unit in ('g', 'kg') then 'mass'
    when p_unit in ('ml', 'l') then 'volume'
    when p_unit = 'pcs' then 'pieces'
    else 'unsupported'
  end
$$;

create or replace function public.production_to_base_quantity(p_quantity numeric, p_unit text)
returns numeric
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_unit in ('kg', 'l') then p_quantity * 1000
    when p_unit in ('g', 'ml', 'pcs') then p_quantity
    else null
  end
$$;

create or replace function public.save_production_recipe_atomic(
  p_recipe_id uuid,
  p_name text,
  p_output_ingredient_id uuid,
  p_category text,
  p_output_quantity numeric,
  p_output_unit text,
  p_batch_duration_minutes integer,
  p_planned_batches_per_month numeric,
  p_sale_price_per_output_unit numeric,
  p_notes text,
  p_is_active boolean,
  p_sort_order integer,
  p_components jsonb,
  p_expenses jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_recipe_id uuid;
  v_output_unit text;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'Укажите название производственной карты.';
  end if;
  if p_output_quantity is null or p_output_quantity <= 0 then
    raise exception using errcode = 'P0001', message = 'Выход партии должен быть больше нуля.';
  end if;
  if p_output_unit not in ('g', 'kg', 'ml', 'l', 'pcs') then
    raise exception using errcode = 'P0001', message = 'Некорректная единица выпуска.';
  end if;
  if p_batch_duration_minutes is null or p_batch_duration_minutes <= 0 then
    raise exception using errcode = 'P0001', message = 'Укажите длительность партии.';
  end if;
  if p_planned_batches_per_month is null or p_planned_batches_per_month < 0 then
    raise exception using errcode = 'P0001', message = 'План партий не может быть отрицательным.';
  end if;
  if p_sale_price_per_output_unit is null or p_sale_price_per_output_unit < 0 then
    raise exception using errcode = 'P0001', message = 'Цена продажи не может быть отрицательной.';
  end if;
  if jsonb_typeof(coalesce(p_components, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_components, '[]'::jsonb)) = 0 then
    raise exception using errcode = 'P0001', message = 'Добавьте хотя бы один сырьевой компонент.';
  end if;
  if jsonb_typeof(coalesce(p_expenses, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'Некорректный список расходов партии.';
  end if;

  select unit into v_output_unit
  from public.ingredients
  where id = p_output_ingredient_id and is_active = true;
  if not found then
    raise exception using errcode = 'P0001', message = 'Выходной полуфабрикат не найден или выключен.';
  end if;
  if public.production_unit_family(v_output_unit) <> public.production_unit_family(p_output_unit) then
    raise exception using errcode = 'P0001', message = 'Единица выпуска не совпадает с единицей выходного ингредиента.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_components) as line(ingredient_id uuid, quantity numeric, unit text, is_primary boolean, sort_order integer)
    left join public.ingredients ingredient on ingredient.id = line.ingredient_id and ingredient.is_active = true
    where ingredient.id is null
      or line.quantity is null
      or line.quantity <= 0
      or line.unit not in ('g', 'kg', 'ml', 'l', 'pcs')
      or public.production_unit_family(ingredient.unit) <> public.production_unit_family(line.unit)
  ) then
    raise exception using errcode = 'P0001', message = 'Проверьте сырьё, количество и единицы компонентов.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_components) as line(ingredient_id uuid)
    where line.ingredient_id = p_output_ingredient_id
  ) then
    raise exception using errcode = 'P0001', message = 'Выходной полуфабрикат нельзя использовать как сырьё этой же карты.';
  end if;
  if (
    select count(*)
    from jsonb_to_recordset(p_components) as line(ingredient_id uuid)
  ) <> (
    select count(distinct line.ingredient_id)
    from jsonb_to_recordset(p_components) as line(ingredient_id uuid)
  ) then
    raise exception using errcode = 'P0001', message = 'Один ингредиент нельзя добавить в карту дважды.';
  end if;
  if (
    select count(*)
    from jsonb_to_recordset(p_components) as line(is_primary boolean)
    where coalesce(line.is_primary, false) = true
  ) > 1 then
    raise exception using errcode = 'P0001', message = 'Основным сырьём можно отметить только одну строку.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_expenses) as expense(category text, name text, amount_per_batch numeric, sort_order integer)
    where expense.category not in ('labor', 'electricity', 'packaging', 'supplies', 'logistics', 'other')
      or length(trim(coalesce(expense.name, ''))) < 2
      or expense.amount_per_batch is null
      or expense.amount_per_batch < 0
  ) then
    raise exception using errcode = 'P0001', message = 'Проверьте расходы партии.';
  end if;

  if p_recipe_id is null then
    insert into public.production_recipes (
      name, output_ingredient_id, category, output_quantity, output_unit,
      batch_duration_minutes, planned_batches_per_month, sale_price_per_output_unit,
      notes, is_active, sort_order
    ) values (
      trim(p_name), p_output_ingredient_id, nullif(trim(coalesce(p_category, '')), ''),
      p_output_quantity, p_output_unit, p_batch_duration_minutes,
      p_planned_batches_per_month, p_sale_price_per_output_unit,
      nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_is_active, true), coalesce(p_sort_order, 100)
    ) returning id into v_recipe_id;
  else
    update public.production_recipes
    set name = trim(p_name),
        output_ingredient_id = p_output_ingredient_id,
        category = nullif(trim(coalesce(p_category, '')), ''),
        output_quantity = p_output_quantity,
        output_unit = p_output_unit,
        batch_duration_minutes = p_batch_duration_minutes,
        planned_batches_per_month = p_planned_batches_per_month,
        sale_price_per_output_unit = p_sale_price_per_output_unit,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        is_active = coalesce(p_is_active, true),
        sort_order = coalesce(p_sort_order, 100)
    where id = p_recipe_id
    returning id into v_recipe_id;
    if v_recipe_id is null then
      raise exception using errcode = 'P0001', message = 'Производственная карта не найдена.';
    end if;
  end if;

  delete from public.production_recipe_items where recipe_id = v_recipe_id;
  insert into public.production_recipe_items (recipe_id, ingredient_id, quantity, unit, is_primary, sort_order)
  select v_recipe_id, line.ingredient_id, line.quantity, line.unit, coalesce(line.is_primary, false), coalesce(line.sort_order, 100)
  from jsonb_to_recordset(p_components) as line(ingredient_id uuid, quantity numeric, unit text, is_primary boolean, sort_order integer);

  delete from public.production_recipe_expenses where recipe_id = v_recipe_id;
  insert into public.production_recipe_expenses (recipe_id, category, name, amount_per_batch, sort_order)
  select v_recipe_id, expense.category, trim(expense.name), expense.amount_per_batch, coalesce(expense.sort_order, 100)
  from jsonb_to_recordset(p_expenses) as expense(category text, name text, amount_per_batch numeric, sort_order integer);

  return v_recipe_id;
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'Для этого выходного ингредиента уже есть производственная карта.';
end;
$$;

create or replace function public.complete_production_run_atomic(
  p_recipe_id uuid,
  p_batch_count numeric,
  p_output_quantity numeric,
  p_notes text,
  p_created_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_recipe public.production_recipes%rowtype;
  v_output_ingredient public.ingredients%rowtype;
  v_run_id uuid;
  v_material_cost numeric := 0;
  v_direct_cost numeric := 0;
  v_monthly_overhead numeric := 0;
  v_total_planned_minutes numeric := 0;
  v_overhead_cost numeric := 0;
  v_total_cost numeric := 0;
  v_output_base numeric := 0;
  v_cost_per_base numeric := 0;
  v_revenue numeric := 0;
  v_gross_profit numeric := 0;
  v_gross_margin numeric := null;
  v_output_stock_before numeric := 0;
  v_weighted_output_cost numeric := 0;
  v_deficits text;
begin
  if p_batch_count is null or p_batch_count <= 0 then
    raise exception using errcode = 'P0001', message = 'Количество партий должно быть больше нуля.';
  end if;
  if p_output_quantity is null or p_output_quantity <= 0 then
    raise exception using errcode = 'P0001', message = 'Фактический выход должен быть больше нуля.';
  end if;

  select * into v_recipe
  from public.production_recipes
  where id = p_recipe_id and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Производственная карта не найдена или выключена.';
  end if;

  select * into v_output_ingredient
  from public.ingredients
  where id = v_recipe.output_ingredient_id and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Выходной полуфабрикат не найден или выключен.';
  end if;

  v_output_base := public.production_to_base_quantity(p_output_quantity, v_recipe.output_unit);
  if v_output_base is null or v_output_base <= 0 then
    raise exception using errcode = 'P0001', message = 'Не удалось рассчитать фактический выход.';
  end if;

  insert into public.inventory_items (ingredient_id, current_quantity, unit)
  select distinct item.ingredient_id, 0, ingredient.unit
  from public.production_recipe_items item
  join public.ingredients ingredient on ingredient.id = item.ingredient_id
  where item.recipe_id = v_recipe.id
  on conflict (ingredient_id) do nothing;

  perform 1
  from public.inventory_items inventory
  join public.production_recipe_items item on item.ingredient_id = inventory.ingredient_id
  where item.recipe_id = v_recipe.id
  order by inventory.ingredient_id
  for update of inventory;

  select string_agg(
    format('%s: нужно %s %s, доступно %s %s',
      ingredient.name,
      round(public.production_to_base_quantity(item.quantity, item.unit) * p_batch_count, 3),
      ingredient.unit,
      round(inventory.current_quantity, 3),
      ingredient.unit
    ),
    '; ' order by ingredient.name
  ) into v_deficits
  from public.production_recipe_items item
  join public.ingredients ingredient on ingredient.id = item.ingredient_id
  join public.inventory_items inventory on inventory.ingredient_id = item.ingredient_id
  where item.recipe_id = v_recipe.id
    and inventory.current_quantity < public.production_to_base_quantity(item.quantity, item.unit) * p_batch_count;

  if v_deficits is not null then
    raise exception using errcode = 'P0001', message = 'Недостаточно сырья: ' || v_deficits;
  end if;

  select coalesce(sum(
    public.production_to_base_quantity(item.quantity, item.unit)
    * ingredient.cost_per_unit
    * p_batch_count
  ), 0) into v_material_cost
  from public.production_recipe_items item
  join public.ingredients ingredient on ingredient.id = item.ingredient_id
  where item.recipe_id = v_recipe.id;

  select coalesce(sum(amount_per_batch), 0) * p_batch_count
  into v_direct_cost
  from public.production_recipe_expenses
  where recipe_id = v_recipe.id;

  select coalesce(sum(quantity * amount_per_unit), 0)
  into v_monthly_overhead
  from public.production_overheads
  where is_active = true;

  select coalesce(sum(batch_duration_minutes * planned_batches_per_month), 0)
  into v_total_planned_minutes
  from public.production_recipes
  where is_active = true and planned_batches_per_month > 0;

  if v_total_planned_minutes > 0 then
    v_overhead_cost := v_monthly_overhead
      * (v_recipe.batch_duration_minutes * p_batch_count / v_total_planned_minutes);
  end if;

  v_total_cost := v_material_cost + v_direct_cost + v_overhead_cost;
  v_cost_per_base := v_total_cost / v_output_base;
  v_revenue := p_output_quantity * v_recipe.sale_price_per_output_unit;
  v_gross_profit := v_revenue - v_total_cost;
  if v_revenue > 0 then
    v_gross_margin := v_gross_profit / v_revenue * 100;
  end if;

  insert into public.production_runs (
    recipe_id, batch_count, output_quantity, output_unit, material_cost, direct_cost,
    overhead_cost, total_cost, cost_per_base_unit, sale_price_per_output_unit,
    planned_revenue, gross_profit, gross_margin_percent, notes, created_by
  ) values (
    v_recipe.id, p_batch_count, p_output_quantity, v_recipe.output_unit,
    v_material_cost, v_direct_cost, v_overhead_cost, v_total_cost, v_cost_per_base,
    v_recipe.sale_price_per_output_unit, v_revenue, v_gross_profit, v_gross_margin,
    nullif(trim(coalesce(p_notes, '')), ''), coalesce(nullif(trim(p_created_by), ''), 'admin')
  ) returning id into v_run_id;

  insert into public.production_run_items (
    run_id, ingredient_id, ingredient_name, quantity_base, unit, is_primary, cost_per_unit, line_cost
  )
  select
    v_run_id,
    item.ingredient_id,
    ingredient.name,
    public.production_to_base_quantity(item.quantity, item.unit) * p_batch_count,
    ingredient.unit,
    item.is_primary,
    ingredient.cost_per_unit,
    public.production_to_base_quantity(item.quantity, item.unit) * ingredient.cost_per_unit * p_batch_count
  from public.production_recipe_items item
  join public.ingredients ingredient on ingredient.id = item.ingredient_id
  where item.recipe_id = v_recipe.id;

  update public.inventory_items inventory
  set current_quantity = inventory.current_quantity - usage.quantity_base,
      updated_at = now()
  from (
    select item.ingredient_id,
           sum(public.production_to_base_quantity(item.quantity, item.unit) * p_batch_count) as quantity_base
    from public.production_recipe_items item
    where item.recipe_id = v_recipe.id
    group by item.ingredient_id
  ) usage
  where inventory.ingredient_id = usage.ingredient_id;

  insert into public.inventory_movements (
    ingredient_id, production_run_id, movement_type, quantity, unit, reason, comment, created_by
  )
  select
    item.ingredient_id,
    v_run_id,
    'production_consumption',
    -public.production_to_base_quantity(item.quantity, item.unit) * p_batch_count,
    ingredient.unit,
    'Производство',
    v_recipe.name,
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  from public.production_recipe_items item
  join public.ingredients ingredient on ingredient.id = item.ingredient_id
  where item.recipe_id = v_recipe.id;

  insert into public.inventory_items (ingredient_id, current_quantity, unit)
  values (v_output_ingredient.id, 0, v_output_ingredient.unit)
  on conflict (ingredient_id) do nothing;

  perform 1
  from public.inventory_items
  where ingredient_id = v_output_ingredient.id
  for update;

  select current_quantity
  into v_output_stock_before
  from public.inventory_items
  where ingredient_id = v_output_ingredient.id;

  v_weighted_output_cost := case
    when v_output_stock_before + v_output_base > 0 then
      (
        v_output_stock_before * v_output_ingredient.cost_per_unit
        + v_output_base * v_cost_per_base
      ) / (v_output_stock_before + v_output_base)
    else v_cost_per_base
  end;

  update public.inventory_items
  set current_quantity = current_quantity + v_output_base,
      unit = v_output_ingredient.unit,
      updated_at = now()
  where ingredient_id = v_output_ingredient.id;

  insert into public.inventory_movements (
    ingredient_id, production_run_id, movement_type, quantity, unit, reason, comment, created_by
  ) values (
    v_output_ingredient.id,
    v_run_id,
    'production_output',
    v_output_base,
    v_output_ingredient.unit,
    'Выпуск производства',
    v_recipe.name,
    coalesce(nullif(trim(p_created_by), ''), 'admin')
  );

  update public.ingredients
  set cost_per_unit = v_weighted_output_cost,
      updated_at = now()
  where id = v_output_ingredient.id;

  insert into public.audit_logs (
    actor_type, action, entity_type, entity_id, metadata, source_path
  ) values (
    'staff',
    'production.run_complete',
    'production_run',
    v_run_id::text,
    jsonb_build_object(
      'recipe_id', v_recipe.id,
      'batch_count', p_batch_count,
      'output_quantity', p_output_quantity,
      'output_unit', v_recipe.output_unit,
      'total_cost', v_total_cost,
      'batch_cost_per_base_unit', v_cost_per_base,
      'weighted_cost_per_base_unit', v_weighted_output_cost
    ),
    '/admin/production'
  );

  return jsonb_build_object(
    'run_id', v_run_id,
    'total_cost', v_total_cost,
    'cost_per_base_unit', v_cost_per_base,
    'planned_revenue', v_revenue,
    'gross_profit', v_gross_profit,
    'gross_margin_percent', v_gross_margin
  );
end;
$$;

alter table public.production_recipes enable row level security;
alter table public.production_recipe_items enable row level security;
alter table public.production_recipe_expenses enable row level security;
alter table public.production_overheads enable row level security;
alter table public.production_runs enable row level security;
alter table public.production_run_items enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'production_recipes',
    'production_recipe_items',
    'production_recipe_expenses',
    'production_overheads',
    'production_runs',
    'production_run_items'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all privileges on table public.%I from anon', v_table);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all privileges on table public.%I from authenticated', v_table);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all privileges on table public.%I to service_role', v_table);
    end if;
    if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
      execute format('grant select, insert, update, delete on table public.%I to karimoff_app', v_table);
      execute format('drop policy if exists %I on public.%I', v_table || '_app_access', v_table);
      execute format(
        'create policy %I on public.%I for all to karimoff_app using (true) with check (true)',
        v_table || '_app_access',
        v_table
      );
    end if;
  end loop;
end
$$;

revoke all on function public.production_unit_family(text) from public;
revoke all on function public.production_to_base_quantity(numeric, text) from public;
revoke all on function public.save_production_recipe_atomic(
  uuid, text, uuid, text, numeric, text, integer, numeric, numeric, text, boolean, integer, jsonb, jsonb
) from public;
revoke all on function public.complete_production_run_atomic(uuid, numeric, numeric, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.production_unit_family(text) to service_role;
    grant execute on function public.production_to_base_quantity(numeric, text) to service_role;
    grant execute on function public.save_production_recipe_atomic(
      uuid, text, uuid, text, numeric, text, integer, numeric, numeric, text, boolean, integer, jsonb, jsonb
    ) to service_role;
    grant execute on function public.complete_production_run_atomic(uuid, numeric, numeric, text, text) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant execute on function public.production_unit_family(text) to karimoff_app;
    grant execute on function public.production_to_base_quantity(numeric, text) to karimoff_app;
    grant execute on function public.save_production_recipe_atomic(
      uuid, text, uuid, text, numeric, text, integer, numeric, numeric, text, boolean, integer, jsonb, jsonb
    ) to karimoff_app;
    grant execute on function public.complete_production_run_atomic(uuid, numeric, numeric, text, text) to karimoff_app;
  end if;
end
$$;
