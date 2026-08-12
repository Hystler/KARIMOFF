-- Provider-neutral, read-only sales analytics over KARIMOFF web orders and
-- imported Evotor receipts. Source rows stay in their operational tables.

create table if not exists public.analytics_sale_reconciliations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  web_order_id uuid not null references public.orders(id) on delete cascade,
  evotor_receipt_id uuid not null references public.evotor_receipts(id) on delete cascade,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  match_method text not null
    check (match_method in ('external_reference', 'fiscal_reference', 'manual')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  confirmed_by text,
  confirmed_at timestamptz,
  note text,
  unique (web_order_id),
  unique (evotor_receipt_id)
);

create table if not exists public.staff_location_access (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  location_key text not null,
  unique (staff_id, location_key)
);

create index if not exists analytics_reconciliations_confirmed_idx
  on public.analytics_sale_reconciliations (status, updated_at desc)
  where status = 'confirmed';
create index if not exists staff_location_access_staff_idx
  on public.staff_location_access (staff_id, location_key);
create index if not exists evotor_receipts_device_closed_idx
  on public.evotor_receipts (device_id, closed_at desc)
  where closed_at is not null;
create index if not exists evotor_receipts_employee_closed_idx
  on public.evotor_receipts (evotor_employee_id, closed_at desc)
  where closed_at is not null and evotor_employee_id is not null;
create index if not exists evotor_receipt_items_product_idx
  on public.evotor_receipt_items (evotor_product_id, receipt_id)
  where evotor_product_id is not null;
create index if not exists orders_completed_analytics_idx
  on public.orders (created_at desc, payment_status)
  where status = 'completed';
create index if not exists orders_sales_effective_at_idx
  on public.orders ((coalesce(kitchen_completed_at, updated_at, created_at)) desc)
  where status = 'completed'
    and payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded');
create index if not exists orders_analytics_at_idx
  on public.orders ((case
    when status = 'completed' then coalesce(kitchen_completed_at, updated_at, created_at)
    else created_at
  end) desc);
create index if not exists order_items_product_order_idx
  on public.order_items (product_id, order_id)
  where product_id is not null;

drop trigger if exists analytics_sale_reconciliations_set_updated_at
  on public.analytics_sale_reconciliations;
create trigger analytics_sale_reconciliations_set_updated_at
before update on public.analytics_sale_reconciliations
for each row execute function public.set_updated_at();

create or replace view public.analytics_sales
with (security_invoker = true)
as
with confirmed_links as (
  select web_order_id, evotor_receipt_id
  from public.analytics_sale_reconciliations
  where status = 'confirmed'
)
select
  'pos_evotor:' || r.id::text as sale_id,
  r.id as source_record_id,
  r.external_receipt_id as external_source_id,
  'pos_evotor'::text as source,
  'pos'::text as source_subtype,
  'pos_evotor:store:' || s.id::text as location_id,
  s.name as location_name,
  case when d.id is null then null else 'pos_evotor:device:' || d.id::text end as terminal_id,
  coalesce(d.name, d.device_model) as terminal_name,
  case when r.evotor_employee_id is null then null else 'pos_evotor:employee:' || r.evotor_employee_id end as employee_id,
  e.display_name as employee_name,
  null::uuid as customer_id,
  null::text as customer_name,
  coalesce(r.receipt_number, r.fiscal_document_number, r.external_receipt_id) as order_number,
  r.closed_at as opened_at,
  r.closed_at as paid_at,
  r.closed_at as completed_at,
  r.closed_at as analytics_at,
  case r.receipt_type when 'return' then 'refunded' when 'correction' then 'corrected' else 'completed' end as status,
  case r.receipt_type when 'return' then 'refund' when 'correction' then 'correction' else 'sale' end as operation_type,
  r.subtotal::numeric as gross_amount,
  r.discount::numeric as discount_amount,
  case when r.receipt_type = 'return' then r.total else 0 end::numeric as refund_amount,
  case when r.receipt_type = 'sale' then r.total when r.receipt_type = 'return' then -r.total else 0 end::numeric as net_revenue,
  case
    when coalesce(pl.payment_method_count, 0) = 0 then 'unknown'
    when pl.payment_method_count = 1 then pl.single_payment_method
    else 'mixed'
  end as payment_method,
  coalesce(it.items_count, 0)::numeric as items_count,
  'RUB'::text as currency,
  (r.receipt_type in ('sale', 'return') and r.closed_at is not null) as analytics_included,
  (r.receipt_type = 'sale' and r.closed_at is not null) as sale_count_eligible,
  true as discount_data_available,
  r.synchronized_at as source_updated_at,
  jsonb_build_object(
    'connection_id', r.connection_id,
    'document_id', r.document_id,
    'receipt_type', r.receipt_type
  ) as source_metadata
from public.evotor_receipts r
join public.evotor_stores s on s.id = r.store_id
left join public.evotor_devices d on d.id = r.device_id
left join public.evotor_employees e
  on e.connection_id = r.connection_id
 and e.evotor_employee_id = r.evotor_employee_id
left join lateral (
  select coalesce(sum(abs(i.quantity)), 0)::numeric as items_count
  from public.evotor_receipt_items i
  where i.receipt_id = r.id
) it on true
left join lateral (
  select
    count(*)::integer as payment_method_count,
    min(
      case upper(coalesce(payment.value->>'type', ''))
        when 'CASH' then 'cash'
        when 'ELECTRON' then 'bank_card'
        when 'CARD' then 'bank_card'
        when 'BANK_CARD' then 'bank_card'
        when 'SBP' then 'sbp'
        when 'QR' then 'sbp'
        else 'unknown'
      end
    ) as single_payment_method
  from jsonb_array_elements(r.payment_types) payment(value)
) pl on true
where not exists (
  select 1 from confirmed_links link where link.evotor_receipt_id = r.id
)

union all

select
  'web:' || o.id::text as sale_id,
  o.id as source_record_id,
  o.id::text as external_source_id,
  'web'::text as source,
  coalesce(o.delivery_type, 'pickup')::text as source_subtype,
  'web:online'::text as location_id,
  'Онлайн'::text as location_name,
  case when cr.id is null then null else 'web:register:' || cr.id::text end as terminal_id,
  cr.name as terminal_name,
  null::text as employee_id,
  null::text as employee_name,
  o.customer_id,
  o.customer_name,
  upper(substr(replace(o.id::text, '-', ''), 1, 8)) as order_number,
  o.created_at as opened_at,
  wp.paid_at,
  case when o.status = 'completed' then coalesce(o.kitchen_completed_at, o.updated_at, o.created_at) end as completed_at,
  case when o.status = 'completed' then coalesce(o.kitchen_completed_at, o.updated_at, o.created_at) else o.created_at end as analytics_at,
  coalesce(o.status, 'new')::text as status,
  case
    when o.status = 'cancelled' then 'cancel'
    when o.payment_status in ('refunded', 'partially_refunded') then 'refund'
    else 'sale'
  end as operation_type,
  o.total::numeric as gross_amount,
  0::numeric as discount_amount,
  case
    when coalesce(wr.completed_refund, 0) > 0 then least(o.total, wr.completed_refund)
    when o.payment_status = 'refunded' then o.total
    else 0
  end::numeric as refund_amount,
  case
    when o.status = 'completed'
     and o.payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded')
      then greatest(0, o.total - case
        when coalesce(wr.completed_refund, 0) > 0 then least(o.total, wr.completed_refund)
        when o.payment_status = 'refunded' then o.total
        else 0
      end)
    else 0
  end::numeric as net_revenue,
  case
    when coalesce(wp.paid_count, 0) = 0 then 'unknown'
    when wp.paid_count = 1 then wp.single_payment_method
    else 'mixed'
  end as payment_method,
  coalesce(wit.items_count, 0)::numeric as items_count,
  'RUB'::text as currency,
  (
    o.status = 'completed'
    and o.payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded')
  ) as analytics_included,
  (
    o.status = 'completed'
    and o.payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded')
  ) as sale_count_eligible,
  false as discount_data_available,
  coalesce(o.updated_at, o.created_at) as source_updated_at,
  jsonb_strip_nulls(jsonb_build_object(
    'delivery_type', o.delivery_type,
    'payment_status', o.payment_status,
    'fiscal_status', o.fiscal_status,
    'reconciled_evotor_receipt_id', link.evotor_receipt_id
  )) as source_metadata
from public.orders o
left join public.cash_registers cr on cr.id = o.cash_register_id
left join lateral (
  select coalesce(sum(refund.amount) filter (where refund.status = 'completed'), 0)::numeric as completed_refund
  from public.refunds refund
  where refund.order_id = o.id
) wr on true
left join lateral (
  select
    count(*) filter (where payment.status = 'paid')::integer as paid_count,
    max(payment.paid_at) filter (where payment.status = 'paid') as paid_at,
    min(
      case
        when lower(payment.provider) in ('cash', 'cash_on_delivery') then 'cash'
        when lower(payment.provider) in ('sbp', 'fps') then 'sbp'
        when lower(payment.provider) in ('card', 'bank_card') then 'bank_card'
        else 'online_acquiring'
      end
    ) filter (where payment.status = 'paid') as single_payment_method
  from public.payments payment
  where payment.order_id = o.id
) wp on true
left join lateral (
  select coalesce(sum(item.quantity), 0)::numeric as items_count
  from public.order_items item
  where item.order_id = o.id
) wit on true
left join confirmed_links link on link.web_order_id = o.id;

create or replace view public.analytics_sale_items
with (security_invoker = true)
as
with confirmed_links as (
  select web_order_id, evotor_receipt_id
  from public.analytics_sale_reconciliations
  where status = 'confirmed'
)
select
  'pos_evotor:' || r.id::text as sale_id,
  'pos_evotor:' || i.id::text as sale_item_id,
  i.id as source_record_id,
  i.source_key as external_source_id,
  'pos_evotor'::text as source,
  i.evotor_product_id as source_product_id,
  case when mapping.status = 'confirmed' then mapping.karimoff_product_id end as product_id,
  coalesce(mapped_product.name, i.name) as product_name,
  case when mapping.status = 'confirmed' then mapped_product.category end as category,
  coalesce(mapping.status, 'unmapped')::text as mapping_status,
  case when r.receipt_type = 'return' then -abs(i.quantity) else abs(i.quantity) end::numeric as net_quantity,
  abs(i.quantity)::numeric as quantity,
  i.unit_price::numeric as unit_price,
  (i.line_total + i.discount)::numeric as gross_amount,
  i.discount::numeric as discount_amount,
  case when r.receipt_type = 'return' then i.line_total else 0 end::numeric as refund_amount,
  case when r.receipt_type = 'return' then -i.line_total when r.receipt_type = 'sale' then i.line_total else 0 end::numeric as net_revenue,
  r.closed_at as analytics_at,
  case r.receipt_type when 'return' then 'refund' when 'correction' then 'correction' else 'sale' end as operation_type
from public.evotor_receipt_items i
join public.evotor_receipts r on r.id = i.receipt_id
left join public.evotor_products ep
  on ep.store_id = r.store_id
 and ep.evotor_product_id = i.evotor_product_id
left join public.evotor_product_mappings mapping on mapping.evotor_product_id = ep.id
left join public.products mapped_product
  on mapped_product.id = mapping.karimoff_product_id
 and mapping.status = 'confirmed'
where not exists (
  select 1 from confirmed_links link where link.evotor_receipt_id = r.id
)

union all

select
  'web:' || o.id::text as sale_id,
  'web:' || i.id::text as sale_item_id,
  i.id as source_record_id,
  i.id::text as external_source_id,
  'web'::text as source,
  i.product_id::text as source_product_id,
  i.product_id,
  coalesce(p.name, i.product_name) as product_name,
  p.category,
  case when i.product_id is null then 'unmapped' else 'native' end::text as mapping_status,
  case when o.payment_status = 'refunded' then 0 else i.quantity end::numeric as net_quantity,
  i.quantity::numeric as quantity,
  i.unit_price::numeric as unit_price,
  i.line_total::numeric as gross_amount,
  0::numeric as discount_amount,
  case when o.payment_status = 'refunded' then i.line_total else 0 end::numeric as refund_amount,
  case
    when o.status = 'completed'
     and o.payment_status in ('paid', 'not_required', 'partially_refunded', 'refunded')
      then case when o.payment_status = 'refunded' then 0 else i.line_total end
    else 0
  end::numeric as net_revenue,
  case when o.status = 'completed' then coalesce(o.kitchen_completed_at, o.updated_at, o.created_at) else o.created_at end as analytics_at,
  case when o.payment_status in ('refunded', 'partially_refunded') then 'refund' else 'sale' end as operation_type
from public.order_items i
join public.orders o on o.id = i.order_id
left join public.products p on p.id = i.product_id;

create or replace view public.analytics_sale_payments
with (security_invoker = true)
as
with confirmed_links as (
  select web_order_id, evotor_receipt_id
  from public.analytics_sale_reconciliations
  where status = 'confirmed'
),
web_paid_orders as (
  select distinct order_id from public.payments where status = 'paid'
)
select
  'pos_evotor:' || r.id::text as sale_id,
  'pos_evotor:' || r.id::text || ':' || payment.ordinality::text as payment_id,
  case upper(coalesce(payment.value->>'type', ''))
    when 'CASH' then 'cash'
    when 'ELECTRON' then 'bank_card'
    when 'CARD' then 'bank_card'
    when 'BANK_CARD' then 'bank_card'
    when 'SBP' then 'sbp'
    when 'QR' then 'sbp'
    else 'unknown'
  end as payment_method,
  coalesce(payment.value->>'type', 'UNKNOWN') as source_payment_method,
  case
    when (payment.value->>'sum') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (payment.value->>'sum')::numeric * case when r.receipt_type = 'return' then -1 else 1 end
    else 0
  end::numeric as amount,
  r.closed_at as paid_at,
  'RUB'::text as currency
from public.evotor_receipts r
cross join lateral jsonb_array_elements(r.payment_types) with ordinality payment(value, ordinality)
left join confirmed_links link on link.evotor_receipt_id = r.id
where link.evotor_receipt_id is null

union all

select
  'web:' || link.web_order_id::text as sale_id,
  'reconciled:' || r.id::text || ':' || payment.ordinality::text as payment_id,
  case upper(coalesce(payment.value->>'type', ''))
    when 'CASH' then 'cash'
    when 'ELECTRON' then 'bank_card'
    when 'CARD' then 'bank_card'
    when 'BANK_CARD' then 'bank_card'
    when 'SBP' then 'sbp'
    when 'QR' then 'sbp'
    else 'unknown'
  end as payment_method,
  coalesce(payment.value->>'type', 'UNKNOWN') as source_payment_method,
  case
    when (payment.value->>'sum') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (payment.value->>'sum')::numeric * case when r.receipt_type = 'return' then -1 else 1 end
    else 0
  end::numeric as amount,
  r.closed_at as paid_at,
  'RUB'::text as currency
from confirmed_links link
join public.evotor_receipts r on r.id = link.evotor_receipt_id
cross join lateral jsonb_array_elements(r.payment_types) with ordinality payment(value, ordinality)
where not exists (
  select 1 from web_paid_orders paid where paid.order_id = link.web_order_id
)

union all

select
  'web:' || p.order_id::text as sale_id,
  'web:' || p.id::text as payment_id,
  case
    when lower(p.provider) in ('cash', 'cash_on_delivery') then 'cash'
    when lower(p.provider) in ('sbp', 'fps') then 'sbp'
    when lower(p.provider) in ('card', 'bank_card') then 'bank_card'
    else 'online_acquiring'
  end as payment_method,
  p.provider as source_payment_method,
  p.amount::numeric as amount,
  p.paid_at,
  p.currency
from public.payments p
where p.status = 'paid';

alter table public.analytics_sale_reconciliations enable row level security;
alter table public.staff_location_access enable row level security;

revoke all privileges on table public.analytics_sale_reconciliations from public;
revoke all privileges on table public.staff_location_access from public;
revoke all privileges on table public.analytics_sales from public;
revoke all privileges on table public.analytics_sale_items from public;
revoke all privileges on table public.analytics_sale_payments from public;

do $$
declare
  v_table text;
  v_policy text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on table public.analytics_sale_reconciliations from anon;
    revoke all privileges on table public.staff_location_access from anon;
    revoke all privileges on table public.analytics_sales from anon;
    revoke all privileges on table public.analytics_sale_items from anon;
    revoke all privileges on table public.analytics_sale_payments from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on table public.analytics_sale_reconciliations from authenticated;
    revoke all privileges on table public.staff_location_access from authenticated;
    revoke all privileges on table public.analytics_sales from authenticated;
    revoke all privileges on table public.analytics_sale_items from authenticated;
    revoke all privileges on table public.analytics_sale_payments from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.analytics_sale_reconciliations to karimoff_app;
    grant select, insert, update, delete on table public.staff_location_access to karimoff_app;
    grant select on table public.analytics_sales to karimoff_app;
    grant select on table public.analytics_sale_items to karimoff_app;
    grant select on table public.analytics_sale_payments to karimoff_app;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'analytics_sale_reconciliations'
        and policyname = 'analytics_sale_reconciliations_app_access'
    ) then
      create policy analytics_sale_reconciliations_app_access
        on public.analytics_sale_reconciliations
        for all
        to karimoff_app
        using (true)
        with check (true);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'staff_location_access'
        and policyname = 'staff_location_access_app_access'
    ) then
      create policy staff_location_access_app_access
        on public.staff_location_access
        for all
        to karimoff_app
        using (true)
        with check (true);
    end if;

    -- The analytics views run as the caller. Give the server-only runtime role
    -- read access to exactly the operational tables used by those views while
    -- preserving RLS and all existing write restrictions.
    foreach v_table in array array[
      'analytics_sale_reconciliations',
      'cash_registers',
      'evotor_devices',
      'evotor_employees',
      'evotor_product_mappings',
      'evotor_products',
      'evotor_receipt_items',
      'evotor_receipts',
      'evotor_stores',
      'order_items',
      'orders',
      'payments',
      'products',
      'refunds'
    ]
    loop
      v_policy := v_table || '_analytics_app_read';
      execute format('grant select on table public.%I to karimoff_app', v_table);

      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = v_table
          and policyname = v_policy
      ) then
        execute format(
          'create policy %I on public.%I for select to karimoff_app using (true)',
          v_policy,
          v_table
        );
      end if;
    end loop;
  end if;
end
$$;
