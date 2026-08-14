"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/admin-auth";
import { canStaffAccessOrder } from "@/lib/order-flow/access";
import { canCancelOrder, canTransitionKitchen } from "@/lib/order-flow/permissions";
import { transitionOrder } from "@/lib/order-flow/service";
import { KITCHEN_STATUSES, type KitchenStatus } from "@/lib/order-flow/types";

export type KitchenActionState = {
  status: "idle" | "success" | "error";
  message: string;
  warnings?: string[];
};

export const initialKitchenActionState: KitchenActionState = { status: "idle", message: "" };

export async function transitionKitchenOrderAction(
  _previous: KitchenActionState,
  formData: FormData
): Promise<KitchenActionState> {
  if (process.env.MAINTENANCE_MODE === "true") {
    return { status: "error", message: "Сервис временно обновляется. Попробуйте снова через несколько минут." };
  }
  const staff = await getCurrentStaff();
  if (!staff) return { status: "error", message: "Сессия завершена. Войдите снова." };
  const orderId = String(formData.get("order_id") ?? "");
  const fromStatus = String(formData.get("from_status") ?? "") as KitchenStatus;
  const toStatus = String(formData.get("to_status") ?? "") as KitchenStatus;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !KITCHEN_STATUSES.includes(fromStatus) || !KITCHEN_STATUSES.includes(toStatus)) {
    return { status: "error", message: "Некорректное действие с заказом." };
  }
  if (!await canStaffAccessOrder(staff, orderId)) {
    return { status: "error", message: "Заказ относится к недоступной точке." };
  }
  if (toStatus === "cancelled") {
    if (!canCancelOrder(staff.role)) return { status: "error", message: "Недостаточно прав для отмены." };
  } else if (!canTransitionKitchen(staff.role, fromStatus, toStatus)) {
    return { status: "error", message: "Этот переход недоступен для вашей роли." };
  }

  try {
    const result = await transitionOrder({
      orderId,
      status: toStatus,
      actorId: staff.id,
      actorRole: staff.role,
      deviceSource: String(formData.get("device_source") || "kds").slice(0, 40)
    });
    revalidatePath("/kitchen");
    revalidatePath("/admin/kitchen");
    revalidatePath("/admin/orders");
    revalidatePath("/display");
    revalidatePath("/admin/analytics");
    return {
      status: "success",
      message: result.already_applied ? "Статус уже был обновлён." : "Статус обновлён.",
      warnings: result.warnings?.filter(Boolean)
    };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return {
      status: "error",
      message: failure.code === "P0001"
        ? failure.message || "Не удалось изменить статус."
        : "Не удалось изменить статус. Проверьте соединение и повторите."
    };
  }
}
