"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { createDatabaseServerClient } from "@/lib/database/server";
import { fetchEvotorSales } from "@/lib/evotor/client";
import { getErpPeriodRange } from "@/lib/erp";

export async function syncEvotorSalesAction(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role === "cook") redirect("/admin/login");

  const period = String(formData.get("period") || "today");
  const database = createDatabaseServerClient();
  if (!database) redirect(`/admin/erp?period=${period}&error=database`);

  const range = getErpPeriodRange(period);
  let documents;
  try {
    documents = await fetchEvotorSales(range);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить чеки Эвотора.";
    redirect(`/admin/erp?period=${period}&error=${encodeURIComponent(message)}`);
  }

  const storeId = process.env.EVOTOR_STORE_ID ?? "";
  const { data: existingRegister } = await database
    .from("cash_registers")
    .select("id")
    .eq("provider", "evotor")
    .eq("external_register_id", storeId)
    .maybeSingle();

  let registerId = existingRegister?.id ? String(existingRegister.id) : "";
  if (!registerId) {
    const { data: created, error } = await database
      .from("cash_registers")
      .insert({
        name: "Эвотор",
        provider: "evotor",
        external_register_id: storeId,
        config: { api_version: "v2", sync_mode: "sales" },
        is_active: true
      })
      .select("id")
      .single();
    if (error || !created?.id) redirect(`/admin/erp?period=${period}&error=register`);
    registerId = String(created.id);
  }

  const ids = documents.map((document) => document.id);
  const { data: existingEvents } = ids.length
    ? await database.from("cash_register_events").select("provider_event_id").in("provider_event_id", ids)
    : { data: [] };
  const existingIds = new Set((existingEvents ?? []).map((event) => String(event.provider_event_id)));
  const rows = documents
    .filter((document) => !existingIds.has(document.id))
    .map((document) => ({
      cash_register_id: registerId,
      event_type: "evotor.document.sell",
      provider_event_id: document.id,
      payload: document,
      processed_at: new Date().toISOString(),
      error_message: null
    }));

  if (rows.length) {
    const { error } = await database.from("cash_register_events").insert(rows);
    if (error) redirect(`/admin/erp?period=${period}&error=${encodeURIComponent("Не удалось сохранить чеки Эвотора.")}`);
  }

  await writeAuditLog({
    action: "evotor.sales_sync",
    actorId: staff.id,
    actorType: "staff",
    entityType: "cash_register",
    entityId: registerId,
    metadata: { fetched: documents.length, inserted: rows.length, period: range.period },
    sourcePath: "/admin/erp"
  });

  revalidatePath("/admin/erp");
  redirect(`/admin/erp?period=${range.period}&synced=${rows.length}`);
}
