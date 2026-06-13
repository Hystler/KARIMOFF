"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function deleteLeadAction(formData: FormData) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/leads?error=missing_id");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/leads?error=supabase");
  }

  const { error } = await supabase.from("leads").delete().eq("id", id);

  if (error) {
    redirect(`/admin/leads?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/leads");
  redirect("/admin/leads?deleted=1");
}
