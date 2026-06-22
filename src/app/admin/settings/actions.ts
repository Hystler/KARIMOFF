"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { normalizeRussianPhone } from "@/lib/phone";
import { siteSettingsSchema } from "@/lib/settings-schema";
import { uploadImageToStorage } from "@/lib/storage-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

const heroImageKeys = [
  "home_hero_image_url",
  "menu_hero_image_url",
  "business_hero_image_url",
  "careers_hero_image_url",
  "franchise_hero_image_url",
  "about_hero_image_url"
] as const;

const heroStorageKeys: Record<(typeof heroImageKeys)[number], string> = {
  home_hero_image_url: "home",
  menu_hero_image_url: "menu",
  business_hero_image_url: "business",
  careers_hero_image_url: "careers",
  franchise_hero_image_url: "franchise",
  about_hero_image_url: "about"
};

async function resolveHeroImageValue(formData: FormData, key: (typeof heroImageKeys)[number]) {
  if (formData.get(`clear_${key}`) === "on") {
    return null;
  }

  const file = formData.get(`${key}_file`);

  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadImageToStorage({
      bucket: "hero",
      file,
      path: `${heroStorageKeys[key]}.webp`,
      upsert: true
    });

    if (uploaded.error) {
      redirect(`/admin/settings?error=${encodeURIComponent(uploaded.error)}`);
    }

    return uploaded.url;
  }

  const value = String(formData.get(key) || "").trim();
  return value || null;
}

function normalizeOptionalPhone(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = normalizeRussianPhone(value);
  return normalized === "+7" ? null : normalized;
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
    hero_subtitle: formData.get("hero_subtitle"),
    home_hero_image_url: formData.get("home_hero_image_url"),
    menu_hero_image_url: formData.get("menu_hero_image_url"),
    business_hero_image_url: formData.get("business_hero_image_url"),
    careers_hero_image_url: formData.get("careers_hero_image_url"),
    franchise_hero_image_url: formData.get("franchise_hero_image_url"),
    about_hero_image_url: formData.get("about_hero_image_url")
  });

  if (!parsed.success) {
    redirect(`/admin/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/settings?error=supabase");
  }

  const heroImageValues = Object.fromEntries(
    await Promise.all(heroImageKeys.map(async (key) => [key, await resolveHeroImageValue(formData, key)]))
  );

  const { error } = await supabase.from("site_settings").upsert(
    {
      id: "main",
      ...parsed.data,
      phone: normalizeOptionalPhone(parsed.data.phone),
      address: parsed.data.address || null,
      working_hours: parsed.data.working_hours || null,
      hero_title: parsed.data.hero_title || null,
      hero_subtitle: parsed.data.hero_subtitle || null,
      ...heroImageValues
    },
    { onConflict: "id" }
  );

  if (error) {
    redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/");
  revalidatePath("/menu");
  revalidatePath("/business");
  revalidatePath("/careers");
  revalidatePath("/franchise");
  revalidatePath("/about");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}
