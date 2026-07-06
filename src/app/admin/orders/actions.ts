"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { deductInventoryForOrder } from "@/lib/inventory";
import { awardLoyaltyForCompletedOrder } from "@/lib/loyalty";
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

  const { data: currentOrder } = await supabase.from("orders").select("status").eq("id", id).maybeSingle();
  let inventoryWarning: string | null = null;

  if (status === "completed" && currentOrder?.status !== "completed") {
    const deduction = await deductInventoryForOrder(id);

    if (!deduction.ok) {
      redirect(`/admin/orders?error=${encodeURIComponent(deduction.message)}`);
    }

    if (deduction.warnings.length) {
      inventoryWarning = deduction.warnings.join(" ");
    }
  }

  const { error } = await supabase.from("orders").update({ status }).eq("id", id);

  if (error) {
    redirect(`/admin/orders?error=${encodeURIComponent(error.message)}`);
  }

  if (status === "completed" && currentOrder?.status !== "completed") {
    await awardLoyaltyForCompletedOrder(id);
  }

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

  revalidatePath("/admin/orders");
  redirect("/admin/orders?deleted=1");
}
