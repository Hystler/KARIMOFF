"use server";

import { after } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { consumeEvotorRateLimitKey } from "@/lib/integrations/evotor/auth";
import { createEvotorSyncEvent } from "@/lib/integrations/evotor/repository";
import { processEvotorSyncEvent } from "@/lib/integrations/evotor/sync";
import { canStaffAccessOrderLocation } from "@/lib/order-flow/access";
import {
  createTerminalPairingCode,
  getTerminalBridgeDeviceLocation,
  queueSyntheticTerminalPreview,
  terminalBridgeReady
} from "@/lib/integrations/evotor/terminal-bridge";

export type TerminalBridgeActionState = {
  status: "idle" | "success" | "error";
  message: string;
  pairingCode?: string;
  expiresAt?: string;
};

async function terminalBridgeStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  return staff;
}

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

export async function createTerminalPairingCodeAction(
  _state: TerminalBridgeActionState,
  formData: FormData
): Promise<TerminalBridgeActionState> {
  const staff = await terminalBridgeStaff();
  if (!terminalBridgeReady()) return { status: "error", message: "Мост кассы пока выключен на сервере." };
  const locationId = String(formData.get("location_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(locationId)) {
    return { status: "error", message: "Не выбрана торговая точка." };
  }
  if (!(await canStaffAccessOrderLocation(staff, locationId))) {
    return { status: "error", message: "Эта торговая точка недоступна." };
  }
  try {
    const rate = await consumeEvotorRateLimitKey(
      "evotor-terminal-pairing-admin",
      staff.id ?? `legacy:${staff.phone}`,
      10
    );
    if (!rate.allowed) return { status: "error", message: "Слишком много кодов. Повторите позже." };
    const pairing = await createTerminalPairingCode({ locationId, staffId: staff.id });
    await writeAuditLog({
      action: "evotor.terminal_pairing.created",
      actorType: staff.legacy ? "admin" : "staff",
      actorId: staff.id,
      entityType: "order_location",
      entityId: locationId,
      metadata: { expires_at: pairing.expiresAt },
      sourcePath: "/admin/integrations/evotor"
    });
    return {
      status: "success",
      message: "Введите код на Эвоторе в течение 10 минут.",
      pairingCode: pairing.code,
      expiresAt: pairing.expiresAt
    };
  } catch {
    return { status: "error", message: "Не удалось создать код привязки." };
  }
}

export async function queueTerminalTestPreviewAction(
  _state: TerminalBridgeActionState,
  formData: FormData
): Promise<TerminalBridgeActionState> {
  const staff = await terminalBridgeStaff();
  if (!terminalBridgeReady()) return { status: "error", message: "Мост кассы пока выключен на сервере." };
  const deviceId = String(formData.get("device_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
    return { status: "error", message: "Сначала привяжите кассу." };
  }
  try {
    const locationId = await getTerminalBridgeDeviceLocation(deviceId);
    if (!locationId || !(await canStaffAccessOrderLocation(staff, locationId))) {
      return { status: "error", message: "Эта касса недоступна." };
    }
    const jobId = await queueSyntheticTerminalPreview({ deviceId, staffId: staff.id });
    await writeAuditLog({
      action: "evotor.terminal_preview.queued",
      actorType: staff.legacy ? "admin" : "staff",
      actorId: staff.id,
      entityType: "evotor_terminal_preview",
      entityId: jobId,
      metadata: { synthetic: true, device_id: deviceId },
      sourcePath: "/admin/integrations/evotor"
    });
    return { status: "success", message: "Тестовый заказ поставлен в очередь кассы." };
  } catch {
    return { status: "error", message: "Не удалось поставить тестовый заказ в очередь." };
  }
}
