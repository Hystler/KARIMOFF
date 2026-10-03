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

drop index if exists public.evotor_terminal_payment_one_active_per_device_idx;
create unique index evotor_terminal_payment_one_active_per_device_idx
  on public.evotor_terminal_payment_intents (device_id)
  where status in ('queued', 'processing', 'fiscal_pending', 'unknown');
