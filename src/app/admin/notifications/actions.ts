"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireNotificationStaff, retryNotificationDelivery } from "@/lib/notifications/operations";
import { logOperationalError } from "@/lib/observability";

export async function retryNotificationAction(formData: FormData) {
  await requireNotificationStaff();
  let outcome = "not_allowed";
  try {
    const retried = await retryNotificationDelivery(
      String(formData.get("delivery_id") ?? ""), formData.get("confirmed") === "yes"
    );
    if (retried) outcome = "queued";
  } catch {
    logOperationalError("order_notification.retry_failed", { code: "retry_failed" });
    outcome = "unavailable";
  }
  revalidatePath("/admin/notifications");
  redirect(`/admin/notifications?result=${outcome}`);
}
