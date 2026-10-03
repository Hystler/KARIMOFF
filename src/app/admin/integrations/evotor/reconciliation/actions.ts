"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getPostgresSql } from "@/lib/postgres/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETURN_PATH = "/admin/integrations/evotor/reconciliation";

async function requireReconciliationStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  return staff;
}

function fail(code: string): never {
  redirect(`${RETURN_PATH}?error=${encodeURIComponent(code)}`);
}

export async function confirmSaleReconciliationAction(formData: FormData) {
  if (process.env.MAINTENANCE_MODE === "true") fail("Сервис временно обновляется.");
  const staff = await requireReconciliationStaff();
  const orderId = String(formData.get("order_id") ?? "");
  const receiptId = String(formData.get("receipt_id") ?? "");
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(receiptId)) {
    fail("Выберите заказ и чек.");
  }

  const sql = getPostgresSql();
  try {
    const result = await sql.begin(async (transaction) => {
      const orders = await transaction<{ id: string; location_id: string; source: string }[]>`
        select id, location_id, source
        from public.orders
        where id = ${orderId}::uuid
          and source in ('web', 'pos', 'mobile', 'kiosk')
        for update
      `;
      const receipts = await transaction<{ id: string; location_id: string | null }[]>`
        select receipt.id, store.location_id
        from public.evotor_receipts receipt
        join public.evotor_stores store on store.id = receipt.store_id
        where receipt.id = ${receiptId}::uuid
          and receipt.receipt_type = 'sale'
        for update of receipt
      `;
      const order = orders[0];
      const receipt = receipts[0];
      if (!order || !receipt) throw new Error("NOT_FOUND");
      if (receipt.location_id && receipt.location_id !== order.location_id) {
        throw new Error("LOCATION_MISMATCH");
      }
      const [posIntent] = await transaction<{ id: string }[]>`
        select id from public.evotor_terminal_payment_intents
        where order_id = ${orderId}::uuid for update
      `;
      if (posIntent) {
        const [proof] = await transaction<{ id: string }[]>`
          select intent.id from public.evotor_terminal_payment_intents intent
          join public.evotor_receipts imported on imported.id = ${receiptId}::uuid
          join public.evotor_devices cloud on cloud.id = imported.device_id
          join public.evotor_stores store on store.id = imported.store_id
          where intent.id = ${posIntent.id}::uuid and intent.status = 'paid'
            and intent.fiscal_storage_number = imported.fiscal_drive_number
            and intent.fiscal_document_number = imported.fiscal_document_number
            and intent.fiscal_sign = imported.fiscal_sign
            and intent.evotor_cloud_device_id = cloud.evotor_device_id
            and intent.evotor_cloud_store_id = store.evotor_store_id
            and intent.amount = imported.total
        `;
        if (!proof) throw new Error("POS_PROOF_REQUIRED");
      }
      if (!staff.legacy && !["owner", "admin"].includes(staff.role)) {
        const access = await transaction<{ allowed: boolean }[]>`
          select exists (
            select 1
            from public.staff_location_access
            where staff_id = ${staff.id}::uuid
              and order_location_id = ${order.location_id}::uuid
          ) as allowed
        `;
        if (!access[0]?.allowed) throw new Error("FORBIDDEN");
      }

      const [previous] = await transaction<{ evotor_receipt_id: string }[]>`
        select evotor_receipt_id from public.analytics_sale_reconciliations
        where web_order_id = ${orderId}::uuid for update
      `;
      const links = await transaction<{ id: string }[]>`
        insert into public.analytics_sale_reconciliations (
          web_order_id, evotor_receipt_id, status, match_method, confidence,
          confirmed_by, confirmed_at, note
        ) values (
          ${orderId}::uuid, ${receiptId}::uuid, 'confirmed', 'manual', 1,
          ${staff.id ?? "legacy-owner"}, now(),
          'Связь подтверждена сотрудником в KARIMOFF ERP'
        )
        on conflict (web_order_id) do update
        set evotor_receipt_id = excluded.evotor_receipt_id,
            status = 'confirmed', match_method = 'manual', confidence = 1,
            confirmed_by = excluded.confirmed_by, confirmed_at = now(),
            note = excluded.note, updated_at = now()
        returning id
      `;
      await transaction`update public.evotor_receipts
        set pos_reconciliation_status = 'matched', updated_at = now()
        where id = ${receiptId}::uuid`;
      if (previous && previous.evotor_receipt_id !== receiptId) {
        await transaction`update public.evotor_receipts
          set pos_reconciliation_status = 'unreconciled', updated_at = now()
          where id = ${previous.evotor_receipt_id}::uuid`;
      }
      await transaction`
        insert into public.audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, metadata, source_path
        ) values (
          ${staff.legacy ? "admin" : "staff"}, ${staff.id}::uuid,
          'sales.reconciliation.confirm', 'analytics_sale_reconciliation',
          ${links[0].id}::text,
          ${transaction.json({ order_id: orderId, receipt_id: receiptId, method: "manual" })},
          ${RETURN_PATH}
        )
      `;
      return links[0].id;
    });
    revalidatePath("/admin/analytics");
    revalidatePath("/admin/analytics/sales");
    revalidatePath(RETURN_PATH);
    redirect(`${RETURN_PATH}?saved=${result}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") fail("Заказ или чек не найден.");
    if (code === "LOCATION_MISMATCH") fail("Заказ и чек относятся к разным точкам.");
    if (code === "FORBIDDEN") fail("Эта точка недоступна вашей учётной записи.");
    if (code === "POS_PROOF_REQUIRED") fail("Для POS нужен точный ФН, ФД, ФП и та же касса Эвотор. Проверьте чек через состояние оплаты в POS.");
    if ((error as { code?: string }).code === "23505") fail("Этот заказ или чек уже связан с другой продажей.");
    fail("Не удалось сохранить сопоставление.");
  }
}

export async function removeSaleReconciliationAction(formData: FormData) {
  if (process.env.MAINTENANCE_MODE === "true") fail("Сервис временно обновляется.");
  const staff = await requireReconciliationStaff();
  const linkId = String(formData.get("link_id") ?? "");
  if (!UUID_PATTERN.test(linkId)) fail("Некорректная связь.");

  const sql = getPostgresSql();
  try {
    await sql.begin(async (transaction) => {
      const links = await transaction<{
        id: string;
        location_id: string;
        order_id: string;
        receipt_id: string;
      }[]>`
        select link.id, orders.location_id, link.web_order_id as order_id,
          link.evotor_receipt_id as receipt_id
        from public.analytics_sale_reconciliations link
        join public.orders on orders.id = link.web_order_id
        where link.id = ${linkId}::uuid
        for update of link
      `;
      const link = links[0];
      if (!link) throw new Error("NOT_FOUND");
      if (!staff.legacy && !["owner", "admin"].includes(staff.role)) {
        const access = await transaction<{ allowed: boolean }[]>`
          select exists (
            select 1
            from public.staff_location_access
            where staff_id = ${staff.id}::uuid
              and order_location_id = ${link.location_id}::uuid
          ) as allowed
        `;
        if (!access[0]?.allowed) throw new Error("FORBIDDEN");
      }
      await transaction`delete from public.analytics_sale_reconciliations where id = ${linkId}::uuid`;
      await transaction`update public.evotor_receipts
        set pos_reconciliation_status = 'unreconciled', updated_at = now()
        where id = ${link.receipt_id}::uuid`;
      await transaction`
        insert into public.audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, metadata, source_path
        ) values (
          ${staff.legacy ? "admin" : "staff"}, ${staff.id}::uuid,
          'sales.reconciliation.remove', 'analytics_sale_reconciliation', ${linkId},
          ${transaction.json({ order_id: link.order_id, receipt_id: link.receipt_id })},
          ${RETURN_PATH}
        )
      `;
    });
    revalidatePath("/admin/analytics");
    revalidatePath("/admin/analytics/sales");
    revalidatePath(RETURN_PATH);
    redirect(`${RETURN_PATH}?removed=1`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (error instanceof Error && error.message === "FORBIDDEN") {
      fail("Эта точка недоступна вашей учётной записи.");
    }
    fail("Не удалось удалить сопоставление.");
  }
}
