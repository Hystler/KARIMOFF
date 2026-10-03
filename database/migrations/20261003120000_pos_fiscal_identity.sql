-- Keep an acquired payment locked until its closed fiscal receipt is identified.
alter table public.evotor_terminal_devices
  add column if not exists cloud_device_id uuid unique
    references public.evotor_devices(id) on delete set null;

alter table public.evotor_terminal_payment_intents
  drop constraint if exists evotor_terminal_payment_intents_status_check;
alter table public.evotor_terminal_payment_intents
  add constraint evotor_terminal_payment_intents_status_check
  check (status in ('queued', 'processing', 'fiscal_pending', 'paid', 'failed', 'cancelled', 'unknown'));

alter table public.evotor_terminal_payment_intents
  add column if not exists local_receipt_uuid text,
  add column if not exists receipt_opened_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists fiscal_storage_number text,
  add column if not exists fiscal_document_number text,
  add column if not exists fiscal_sign text,
  add column if not exists fiscalized_at timestamptz,
  add column if not exists receipt_number text,
  add column if not exists acquiring_reference text,
  add column if not exists evotor_cloud_device_id text,
  add column if not exists evotor_cloud_store_id text,
  add column if not exists evotor_cloud_document_id text;

alter table public.evotor_receipts
  add column if not exists pos_reconciliation_status text not null default 'unreconciled';
alter table public.evotor_receipts
  drop constraint if exists evotor_receipts_pos_reconciliation_status_check;
alter table public.evotor_receipts
  add constraint evotor_receipts_pos_reconciliation_status_check
    check (pos_reconciliation_status in ('unreconciled', 'ambiguous', 'matched'));

create unique index if not exists evotor_terminal_intent_local_receipt_uuid_key
  on public.evotor_terminal_payment_intents (local_receipt_uuid)
  where local_receipt_uuid is not null;
create unique index if not exists evotor_terminal_intent_fiscal_identity_key
  on public.evotor_terminal_payment_intents
    (fiscal_storage_number, fiscal_document_number, fiscal_sign)
  where fiscal_storage_number is not null and fiscal_document_number is not null
    and fiscal_sign is not null;
create index if not exists evotor_receipts_fiscal_identity_idx
  on public.evotor_receipts (fiscal_drive_number, fiscal_document_number, fiscal_sign)
  where fiscal_drive_number is not null and fiscal_document_number is not null
    and fiscal_sign is not null;

-- A cloud SELL may contain several fiscal print groups. Preserve each result;
-- a single receipt-level fiscal tuple cannot represent a split check safely.
create table if not exists public.evotor_receipt_fiscal_groups (
  receipt_id uuid not null references public.evotor_receipts(id) on delete cascade,
  group_index integer not null check (group_index >= 0),
  print_group_id text,
  fiscal_storage_number text,
  fiscal_document_number text,
  fiscal_sign text,
  receipt_number text,
  document_number text,
  check_sum numeric,
  primary key (receipt_id, group_index)
);
create index if not exists evotor_receipt_fiscal_groups_identity_idx
  on public.evotor_receipt_fiscal_groups
    (fiscal_storage_number, fiscal_document_number, fiscal_sign)
  where fiscal_storage_number is not null and fiscal_document_number is not null
    and fiscal_sign is not null;
-- Existing sanitized cloud documents already retain the original print array.
insert into public.evotor_receipt_fiscal_groups (
  receipt_id, group_index, print_group_id, fiscal_storage_number,
  fiscal_document_number, fiscal_sign, receipt_number, document_number, check_sum
)
select receipt.id, (print_result.ordinality - 1)::integer,
  fiscal.payload->>'print_group_id',
  coalesce(fiscal.payload->>'fn_serial_number', fiscal.payload->>'fiscal_drive_number'),
  fiscal.payload->>'fiscal_document_number',
  coalesce(fiscal.payload->>'fiscal_sign_doc_number', fiscal.payload->>'fiscal_sign'),
  fiscal.payload->>'receipt_number', fiscal.payload->>'document_number',
  case when fiscal.payload->>'check_sum' ~ '^[0-9]+(\.[0-9]+)?$'
    then (fiscal.payload->>'check_sum')::numeric else null end
from public.evotor_receipts receipt
cross join lateral (
  select case when jsonb_typeof(receipt.raw_metadata #> '{body,pos_print_results}') = 'array'
    then receipt.raw_metadata #> '{body,pos_print_results}' else '[]'::jsonb end as records
) print_array
cross join lateral jsonb_array_elements(print_array.records)
  with ordinality as print_result(value, ordinality)
cross join lateral (
  select coalesce(print_result.value->'pos_print_result', print_result.value) as payload
) fiscal
on conflict (receipt_id, group_index) do nothing;
update public.evotor_receipts receipt
set fiscal_drive_number = null, fiscal_document_number = null, fiscal_sign = null
where (select count(*) from public.evotor_receipt_fiscal_groups fiscal_group
  where fiscal_group.receipt_id = receipt.id) > 1;
alter table public.evotor_receipt_fiscal_groups enable row level security;
revoke all on table public.evotor_receipt_fiscal_groups from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.evotor_receipt_fiscal_groups from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.evotor_receipt_fiscal_groups from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant select, insert, update, delete on table public.evotor_receipt_fiscal_groups to karimoff_app;
    drop policy if exists runtime_application_dml on public.evotor_receipt_fiscal_groups;
    create policy runtime_application_dml on public.evotor_receipt_fiscal_groups
      for all to karimoff_app using (true) with check (true);
  end if;
end;
$$;

drop index if exists public.evotor_terminal_payment_one_active_per_device_idx;
create unique index evotor_terminal_payment_one_active_per_device_idx
  on public.evotor_terminal_payment_intents (device_id)
  where status in ('queued', 'processing', 'fiscal_pending', 'unknown');
