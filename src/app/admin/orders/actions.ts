"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, isAdminAuthenticated } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["new", "in_progress", "completed", "cancelled"]);

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getOrderId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/orders?error=missing_id");
  }

  return id;
}

export async function updateOrderStatusAction(formData: FormData) {
  await requireAdmin();

  const id = getOrderId(formData);
  const status = String(formData.get("status") || "");

  if (!allowedStatuses.has(status)) {
    redirect("/admin/orders?error=bad_status");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/orders?error=supabase");
  }

  const { data, error } = await supabase.rpc("set_order_status_atomic", {
    p_actor_ref_hash: getAdminActorHash(),
    p_order_id: id,
    p_source_path: "/admin/orders",
    p_status: status
  });

  if (error) {
    const message = error.code === "P0001" ? error.message : "Не удалось изменить статус заказа.";
    redirect(`/admin/orders?error=${encodeURIComponent(message)}`);
  }

  const result = (data ?? {}) as { warnings?: string[] };
  const inventoryWarning = result.warnings?.filter(Boolean).join(" ") || null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/economics");
  redirect(`/admin/orders?saved=1${inventoryWarning ? `&warning=${encodeURIComponent(inventoryWarning)}` : ""}`);
}

export async function deleteOrderAction(formData: FormData) {
  await requireAdmin();

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
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "order",
    sourcePath: "/admin/orders"
  });
  revalidatePath("/admin/orders");
  redirect("/admin/orders?deleted=1");
}
