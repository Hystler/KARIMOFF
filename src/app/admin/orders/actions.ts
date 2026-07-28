"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["new", "in_progress", "completed", "cancelled"]);

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
  const status = String(formData.get("status") || "");
  const returnTo = formData.get("return_to") === "/admin/kitchen" ? "/admin/kitchen" : "/admin/orders";

  if (!allowedStatuses.has(status)) {
    redirect("/admin/orders?error=bad_status");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/orders?error=supabase");
  }

  const { data, error } = await supabase.rpc("set_order_status_staff_atomic", {
    p_actor_id: staff.id,
    p_actor_role: staff.role,
    p_order_id: id,
    p_source_path: returnTo,
    p_status: status
  });

  if (error) {
    const message = error.code === "P0001" ? error.message : "Не удалось изменить статус заказа.";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  const result = (data ?? {}) as { warnings?: string[] };
  const inventoryWarning = result.warnings?.filter(Boolean).join(" ") || null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/kitchen");
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/economics");
  redirect(`${returnTo}?saved=1${inventoryWarning ? `&warning=${encodeURIComponent(inventoryWarning)}` : ""}`);
}

export async function deleteOrderAction(formData: FormData) {
  const staff = await requireStaff();
  if (staff.role === "cook") redirect("/admin/kitchen");

  const id = getOrderId(formData);
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/orders?error=supabase");
  }

  const { error } = await supabase.from("orders").delete().eq("id", id);

  if (error) {
    redirect(`/admin/orders?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "order.delete",
    actorId: staff.id,
    actorRefHash: staff.legacy ? getAdminActorHash() : null,
    actorType: staff.legacy ? "admin" : "staff",
    entityId: id,
    entityType: "order",
    sourcePath: "/admin/orders"
  });
  revalidatePath("/admin/orders");
  redirect("/admin/orders?deleted=1");
}
