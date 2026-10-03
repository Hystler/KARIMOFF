import "server-only";

import type { TransactionSql } from "postgres";

// Both sides must already contain the same fiscal identity. Amount is only a sanity check.
export async function reconcileEvotorReceipt(sql: TransactionSql, receiptId: string) {
  const [receipt] = await sql<{
    id: string;
    external_receipt_id: string;
    fiscal_drive_number: string | null;
    fiscal_document_number: string | null;
    fiscal_sign: string | null;
    total: string | number;
    location_id: string | null;
    evotor_device_id: string | null;
    evotor_store_id: string;
  }[]>`
    select receipt.id, receipt.external_receipt_id, receipt.fiscal_drive_number,
      receipt.fiscal_document_number, receipt.fiscal_sign, receipt.total,
      store.location_id, device.evotor_device_id, store.evotor_store_id
    from public.evotor_receipts receipt
    join public.evotor_stores store on store.id = receipt.store_id
    left join public.evotor_devices device on device.id = receipt.device_id
    where receipt.id = ${receiptId}::uuid and receipt.receipt_type = 'sale'
    for update of receipt
  `;
  if (!receipt?.location_id || !receipt.evotor_device_id) return false;

  type FiscalGroup = {
    group_index: number;
    fiscal_storage_number: string | null;
    fiscal_document_number: string | null;
    fiscal_sign: string | null;
  };
  const storedGroups = await sql<FiscalGroup[]>`
    select group_index, fiscal_storage_number, fiscal_document_number, fiscal_sign
    from public.evotor_receipt_fiscal_groups
    where receipt_id = ${receipt.id}::uuid
    order by group_index
  `;
  // Pre-migration rows may have only the original single fiscal tuple.
  const groups = storedGroups.length ? storedGroups : [{
    group_index: -1,
    fiscal_storage_number: receipt.fiscal_drive_number,
    fiscal_document_number: receipt.fiscal_document_number,
    fiscal_sign: receipt.fiscal_sign
  }];
  const matches: Array<{
    group: FiscalGroup;
    intent: { id: string; order_id: string; payment_id: string };
  }> = [];
  for (const group of groups) {
    if (!group.fiscal_storage_number || !group.fiscal_document_number || !group.fiscal_sign) continue;
    const intents = await sql<{ id: string; order_id: string; payment_id: string }[]>`
      select intent.id, intent.order_id, intent.payment_id
      from public.evotor_terminal_payment_intents intent
      join public.orders order_row on order_row.id = intent.order_id
      where order_row.location_id = ${receipt.location_id}::uuid
        and intent.status = 'paid'
        and intent.fiscal_storage_number = ${group.fiscal_storage_number}
        and intent.fiscal_document_number = ${group.fiscal_document_number}
        and intent.fiscal_sign = ${group.fiscal_sign}
        and intent.evotor_cloud_device_id = ${receipt.evotor_device_id}
        and intent.evotor_cloud_store_id = ${receipt.evotor_store_id}
        and intent.amount = ${receipt.total}::numeric
      for update of intent
    `;
    matches.push(...intents.map((intent) => ({ group, intent })));
  }
  if (matches.length !== 1) {
    await sql`update public.evotor_receipts
      set pos_reconciliation_status = ${matches.length > 1 ? "ambiguous" : "unreconciled"},
        updated_at = now() where id = ${receipt.id}::uuid
        and pos_reconciliation_status <> 'matched'`;
    return false;
  }
  const { group, intent } = matches[0];
  const copies = await sql<{ id: string; group_index: number | null }[]>`
    select other.id, other_group.group_index from public.evotor_receipts other
    join public.evotor_stores store on store.id = other.store_id
    join public.evotor_devices device on device.id = other.device_id
    left join public.evotor_receipt_fiscal_groups other_group on other_group.receipt_id = other.id
    where store.location_id = ${receipt.location_id}::uuid
      and store.evotor_store_id = ${receipt.evotor_store_id}
      and device.evotor_device_id = ${receipt.evotor_device_id}
      and other.receipt_type = 'sale'
      and ((other_group.fiscal_storage_number = ${group.fiscal_storage_number}
          and other_group.fiscal_document_number = ${group.fiscal_document_number}
          and other_group.fiscal_sign = ${group.fiscal_sign})
        or (other_group.receipt_id is null
          and other.fiscal_drive_number = ${group.fiscal_storage_number}
          and other.fiscal_document_number = ${group.fiscal_document_number}
          and other.fiscal_sign = ${group.fiscal_sign}))
    limit 2
  `;
  if (copies.length !== 1) {
    await sql`update public.evotor_receipts
      set pos_reconciliation_status = 'ambiguous', updated_at = now()
      where id = ${receipt.id}::uuid and pos_reconciliation_status <> 'matched'`;
    return false;
  }
  const linked = await sql<{ id: string }[]>`
    insert into public.analytics_sale_reconciliations (
      web_order_id, evotor_receipt_id, status, match_method, confidence,
      confirmed_by, confirmed_at, note
    ) values (
      ${intent.order_id}::uuid, ${receipt.id}::uuid, 'confirmed', 'fiscal_reference', 1,
      'system:evotor-fiscal-identity', now(),
      'Exact FN, fiscal document number and fiscal sign; location and amount verified'
    )
    on conflict do nothing returning id
  `;
  if (!linked.length) {
    const [existing] = await sql<{ id: string }[]>`
      select id from public.analytics_sale_reconciliations
      where web_order_id = ${intent.order_id}::uuid
        and evotor_receipt_id = ${receipt.id}::uuid
        and status = 'confirmed'
    `;
    if (!existing) {
      await sql`update public.evotor_receipts
        set pos_reconciliation_status = 'ambiguous', updated_at = now()
        where id = ${receipt.id}::uuid and pos_reconciliation_status <> 'matched'`;
      return false;
    }
  }
  await sql`
    update public.evotor_terminal_payment_intents
    set evotor_cloud_document_id = ${receipt.external_receipt_id},
        evotor_cloud_device_id = ${receipt.evotor_device_id},
        evotor_cloud_store_id = ${receipt.evotor_store_id}, updated_at = now()
    where id = ${intent.id}::uuid
  `;
  await sql`
    update public.fiscal_receipts
    set payload = coalesce(payload, '{}'::jsonb)
      || jsonb_build_object('evotor_cloud_document_id', ${receipt.external_receipt_id}::text),
      updated_at = now()
    where payment_id = ${intent.payment_id}::uuid and provider = 'evotor'
  `;
  await sql`update public.evotor_receipts
    set pos_reconciliation_status = 'matched',
        fiscal_drive_number = ${group.fiscal_storage_number},
        fiscal_document_number = ${group.fiscal_document_number},
        fiscal_sign = ${group.fiscal_sign}, updated_at = now()
    where id = ${receipt.id}::uuid`;
  return true;
}
