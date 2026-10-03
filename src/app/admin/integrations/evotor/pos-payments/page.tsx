import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { getPostgresSql } from "@/lib/postgres/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  order_id: string;
  payment_id: string;
  display_number: string | null;
  status: string;
  amount: string | number;
  device_id: string;
  device_label: string;
  local_receipt_uuid: string | null;
  receipt_opened_at: string | null;
  payment_confirmed_at: string | null;
  fiscal_storage_number: string | null;
  fiscal_document_number: string | null;
  fiscal_sign: string | null;
  fiscalized_at: string | null;
  receipt_number: string | null;
  acquiring_reference: string | null;
  evotor_cloud_document_id: string | null;
  evotor_cloud_device_id: string | null;
  evotor_cloud_store_id: string | null;
  cloud_fiscal_groups: Array<{
    group_index: number;
    fiscal_storage_number: string | null;
    fiscal_document_number: string | null;
    fiscal_sign: string | null;
    receipt_number: string | null;
    document_number: string | null;
    check_sum: string | number | null;
  }>;
};

function Value({ label, value }: { label: string; value: string | number | null }) {
  return <div className="min-w-0"><dt className="text-xs font-bold text-black/50">{label}</dt>
    <dd className="mt-1 break-all font-mono text-xs text-black/80">{value ?? "—"}</dd></div>;
}

export default async function EvotorPosPaymentsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  const locations = await getAccessibleOrderLocations(staff);
  const ids = locations.map((location) => location.id);
  const rows = ids.length ? await getPostgresSql()<Row[]>`
    select intent.id, intent.order_id, intent.payment_id, order_row.display_number,
      intent.status, intent.amount, intent.device_id, device.label as device_label,
      intent.local_receipt_uuid, intent.receipt_opened_at, intent.payment_confirmed_at,
      intent.fiscal_storage_number, intent.fiscal_document_number, intent.fiscal_sign,
      intent.fiscalized_at, intent.receipt_number, intent.acquiring_reference,
      intent.evotor_cloud_document_id, intent.evotor_cloud_device_id, intent.evotor_cloud_store_id,
      coalesce((select jsonb_agg(jsonb_build_object(
        'group_index', fiscal_group.group_index,
        'fiscal_storage_number', fiscal_group.fiscal_storage_number,
        'fiscal_document_number', fiscal_group.fiscal_document_number,
        'fiscal_sign', fiscal_group.fiscal_sign,
        'receipt_number', fiscal_group.receipt_number,
        'document_number', fiscal_group.document_number,
        'check_sum', fiscal_group.check_sum
      ) order by fiscal_group.group_index)
      from public.analytics_sale_reconciliations link
      join public.evotor_receipt_fiscal_groups fiscal_group
        on fiscal_group.receipt_id = link.evotor_receipt_id
      where link.web_order_id = intent.order_id and link.status = 'confirmed'), '[]'::jsonb)
        as cloud_fiscal_groups
    from public.evotor_terminal_payment_intents intent
    join public.orders order_row on order_row.id = intent.order_id
    join public.evotor_terminal_devices device on device.id = intent.device_id
    where order_row.location_id = any(${ids}::uuid[])
    order by intent.created_at desc limit 50
  ` : [];
  return <main className="admin-content admin-content-wide">
    <header className="admin-heading"><div>
      <Link href="/admin/integrations/evotor" className="text-sm font-bold text-black/55">← Эвотор</Link>
      <p className="admin-eyebrow mt-3">Физическая касса</p>
      <h1>Цепочка POS и чека</h1>
      <p>Последние 50 операций. Данные для проверки связи заказа, кассы и фискального чека.</p>
    </div></header>
    <div className="mt-6 space-y-4">{rows.length ? rows.map((row) => <section key={row.id} className="admin-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">Заказ {row.display_number ?? row.order_id}</h2>
        <span className="rounded-md bg-black/5 px-3 py-1 text-sm font-bold">{row.status} · {row.amount} ₽</span></div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Value label="Order ID" value={row.order_id} />
        <Value label="Payment ID" value={row.payment_id} />
        <Value label="Payment intent / bridge task ID" value={row.id} />
        <Value label="Выбранная касса" value={`${row.device_label} · ${row.device_id}`} />
        <Value label="Local receipt UUID" value={row.local_receipt_uuid} />
        <Value label="Чек открыт" value={row.receipt_opened_at} />
        <Value label="Оплата подтверждена" value={row.payment_confirmed_at} />
        <Value label="ФН" value={row.fiscal_storage_number} />
        <Value label="ФД" value={row.fiscal_document_number} />
        <Value label="ФП" value={row.fiscal_sign} />
        <Value label="Фискализирован" value={row.fiscalized_at} />
        <Value label="Номер чека" value={row.receipt_number} />
        <Value label="ID банковской операции / RRN" value={row.acquiring_reference} />
        <Value label="Cloud document ID" value={row.evotor_cloud_document_id} />
        <Value label="Cloud device ID" value={row.evotor_cloud_device_id} />
        <Value label="Cloud store ID" value={row.evotor_cloud_store_id} />
      </dl>
      {row.cloud_fiscal_groups.length > 0 && <div className="mt-5 border-t border-black/10 pt-4">
        <h3 className="text-sm font-bold">Печатные группы облачного чека</h3>
        <div className="mt-3 space-y-3">{row.cloud_fiscal_groups.map((group) =>
          <dl key={group.group_index} className="grid gap-3 rounded-lg bg-black/[0.03] p-3 sm:grid-cols-3">
            <Value label={`Группа ${group.group_index + 1} · ФН`} value={group.fiscal_storage_number} />
            <Value label="ФД" value={group.fiscal_document_number} />
            <Value label="ФП" value={group.fiscal_sign} />
            <Value label="Номер чека" value={group.receipt_number} />
            <Value label="Номер документа" value={group.document_number} />
            <Value label="Сумма печатной группы" value={group.check_sum} />
          </dl>)}</div>
      </div>}
    </section>) : <p className="admin-card p-5">Операций POS пока нет.</p>}</div>
  </main>;
}
