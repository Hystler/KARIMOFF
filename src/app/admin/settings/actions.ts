"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { siteSettingsSchema } from "@/lib/settings-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

export async function updateSiteSettingsAction(formData: FormData) {
  await requireAdmin();

  const parsed = siteSettingsSchema.safeParse({
    site_name: formData.get("site_name"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    working_hours: formData.get("working_hours"),
    delivery_enabled: formData.get("delivery_enabled") === "on",
    pickup_enabled: formData.get("pickup_enabled") === "on",
    theme: formData.get("theme"),
    loyalty_enabled: formData.get("loyalty_enabled") === "on",
    loyalty_percent: formData.get("loyalty_percent"),
    hero_title: formData.get("hero_title"),
    hero_subtitle: formData.get("hero_subtitle")
  });

  if (!parsed.success) {
    redirect(`/admin/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/settings?error=supabase");
  }

  const { error } = await supabase.from("site_settings").upsert(
    {
      id: "main",
      ...parsed.data,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      working_hours: parsed.data.working_hours || null,
      hero_title: parsed.data.hero_title || null,
      hero_subtitle: parsed.data.hero_subtitle || null
    },
    { onConflict: "id" }
  );

  if (error) {
    redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}
