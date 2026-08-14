"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentStaff } from "@/lib/admin-auth";
import { canStaffAccessOrderLocation } from "@/lib/order-flow/access";
import { getPostgresSql } from "@/lib/postgres/server";

const schema = z.object({
  locationId: z.string().uuid(),
  warningMinutes: z.coerce.number().int().min(1).max(120),
  criticalMinutes: z.coerce.number().int().min(2).max(240),
  readyDisplayMinutes: z.coerce.number().int().min(1).max(1440),
  onlineRequiresPaid: z.boolean(),
  posRequiresPaid: z.boolean()
}).refine((value) => value.criticalMinutes > value.warningMinutes, {
  message: "Критический порог должен быть больше предупреждения."
});

export async function saveKitchenSlaAction(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  const parsed = schema.safeParse({
    locationId: formData.get("location_id"),
    warningMinutes: formData.get("warning_minutes"),
    criticalMinutes: formData.get("critical_minutes"),
    readyDisplayMinutes: formData.get("ready_display_minutes"),
    onlineRequiresPaid: formData.get("online_requires_paid") === "on",
    posRequiresPaid: formData.get("pos_requires_paid") === "on"
  });
  const locationId = String(formData.get("location_id") ?? "");
  if (!parsed.success) {
    redirect(`/admin/kitchen?location=${encodeURIComponent(locationId)}&error=${encodeURIComponent(parsed.error.issues[0]?.message || "Проверьте настройки SLA.")}`);
  }
  if (process.env.MAINTENANCE_MODE === "true") {
    redirect(`/admin/kitchen?location=${encodeURIComponent(parsed.data.locationId)}&error=${encodeURIComponent("Сервис временно обновляется.")}`);
  }
  if (!await canStaffAccessOrderLocation(staff, parsed.data.locationId)) {
    redirect("/admin/kitchen?error=Недоступная%20точка");
  }

  const sql = getPostgresSql();
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into public.kitchen_sla_settings (
          location_id, warning_seconds, critical_seconds, ready_display_seconds,
          online_requires_paid, pos_requires_paid, inventory_trigger, updated_at
        ) values (
          ${parsed.data.locationId}::uuid,
          ${parsed.data.warningMinutes * 60},
          ${parsed.data.criticalMinutes * 60},
          ${parsed.data.readyDisplayMinutes * 60},
          ${parsed.data.onlineRequiresPaid},
          ${parsed.data.posRequiresPaid},
          'ready', now()
        )
        on conflict (location_id) do update
        set warning_seconds = excluded.warning_seconds,
            critical_seconds = excluded.critical_seconds,
            ready_display_seconds = excluded.ready_display_seconds,
            online_requires_paid = excluded.online_requires_paid,
            pos_requires_paid = excluded.pos_requires_paid,
            inventory_trigger = 'ready',
            updated_at = now()
      `;
      await transaction`
        insert into public.audit_logs (
          actor_type, actor_id, action, entity_type, entity_id, metadata, source_path
        ) values (
          ${staff.legacy ? "admin" : "staff"}, ${staff.id}::uuid,
          'kitchen.sla.update', 'order_location', ${parsed.data.locationId},
          ${transaction.json({
            warning_seconds: parsed.data.warningMinutes * 60,
            critical_seconds: parsed.data.criticalMinutes * 60,
            ready_display_seconds: parsed.data.readyDisplayMinutes * 60,
            online_requires_paid: parsed.data.onlineRequiresPaid,
            pos_requires_paid: parsed.data.posRequiresPaid,
            inventory_trigger: "ready"
          })},
          '/admin/kitchen'
        )
      `;
    });
  } catch {
    redirect(`/admin/kitchen?location=${encodeURIComponent(parsed.data.locationId)}&error=${encodeURIComponent("Не удалось сохранить настройки кухни.")}`);
  }
  revalidatePath("/admin/kitchen");
  revalidatePath("/kitchen");
  revalidatePath("/display");
  redirect(`/admin/kitchen?location=${encodeURIComponent(parsed.data.locationId)}&saved=1`);
}
