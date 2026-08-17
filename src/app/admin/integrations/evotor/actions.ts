"use server";

import { after } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { consumeEvotorRateLimitKey } from "@/lib/integrations/evotor/auth";
import { createEvotorSyncEvent } from "@/lib/integrations/evotor/repository";
import { processEvotorSyncEvent } from "@/lib/integrations/evotor/sync";

async function queueAdminSync(formData: FormData, syncType: "manual" | "check" | "incremental") {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    redirect("/admin/integrations/evotor?error=connection");
  }
  const actor = staff.id ?? `legacy:${staff.phone}`;
  const rate = await consumeEvotorRateLimitKey(`evotor-admin-${syncType}`, actor, syncType === "check" ? 20 : 6);
  if (!rate.allowed) redirect("/admin/integrations/evotor?error=rate_limit");

  const eventId = await createEvotorSyncEvent({
    connectionId,
    syncType,
    requestedBy: staff.id ?? "owner"
  });
  await writeAuditLog({
    action: syncType === "manual"
      ? "evotor.sync.requested"
      : syncType === "incremental"
        ? "evotor.sync.incremental_requested"
        : "evotor.connection_check.requested",
    actorType: staff.legacy ? "admin" : "staff",
    actorId: staff.id,
    entityType: "evotor_connection",
    entityId: connectionId,
    metadata: { event_id: eventId },
    sourcePath: "/admin/integrations/evotor"
  });
  after(async () => {
    await processEvotorSyncEvent(eventId);
    revalidateTag("karimoff-analytics", { expire: 0 });
    revalidatePath("/admin/integrations/evotor");
    revalidatePath("/admin/analytics/sales");
  });
  redirect(`/admin/integrations/evotor?queued=${syncType}`);
}

export async function syncEvotorAction(formData: FormData) {
  return queueAdminSync(formData, "manual");
}

export async function checkEvotorAction(formData: FormData) {
  return queueAdminSync(formData, "check");
}

export async function incrementalEvotorAction(formData: FormData) {
  return queueAdminSync(formData, "incremental");
}
