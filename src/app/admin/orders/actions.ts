"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { canStaffAccessOrder } from "@/lib/order-flow/access";
import { canCancelOrder, canTransitionKitchen } from "@/lib/order-flow/permissions";
import { transitionOrder } from "@/lib/order-flow/service";
import { KITCHEN_STATUSES, type KitchenStatus } from "@/lib/order-flow/types";

const allowedStatuses = new Set<string>(KITCHEN_STATUSES);

async function requireStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}

function getOrderId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/orders?error=missing_id");
  }

  return id;
}

export async function updateOrderStatusAction(formData: FormData) {
  const staff = await requireStaff();

  const id = getOrderId(formData);
  const status = String(formData.get("status") || "") as KitchenStatus;
  const fromStatus = String(formData.get("from_status") || "") as KitchenStatus;
  const returnTo = formData.get("return_to") === "/admin/kitchen" ? "/admin/kitchen" : "/admin/orders";

  if (!allowedStatuses.has(status)) {
    redirect("/admin/orders?error=bad_status");
  }

  if (!await canStaffAccessOrder(staff, id)) {
    redirect(`${returnTo}?error=${encodeURIComponent("Заказ относится к недоступной точке.")}`);
  }

  if (status === "cancelled" ? !canCancelOrder(staff.role) : !canTransitionKitchen(staff.role, fromStatus, status)) {
    redirect(`${returnTo}?error=${encodeURIComponent("Этот переход недоступен для вашей роли.")}`);
  }
  let inventoryWarning: string | null = null;
  try {
    const result = await transitionOrder({
      orderId: id,
      status,
      actorId: staff.id,
      actorRole: staff.role,
      deviceSource: "admin-orders"
    });
    inventoryWarning = result.warnings?.filter(Boolean).join(" ") || null;
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const message = failure.code === "P0001" ? failure.message : "Не удалось изменить статус заказа.";
    redirect(`${returnTo}?error=${encodeURIComponent(message || "Не удалось изменить статус заказа.")}`);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/kitchen");
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/economics");
  redirect(`${returnTo}?saved=1${inventoryWarning ? `&warning=${encodeURIComponent(inventoryWarning)}` : ""}`);
}
