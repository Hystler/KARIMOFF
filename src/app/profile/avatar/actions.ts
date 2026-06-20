"use server";

import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { avatarSchema } from "@/lib/avatar-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function saveAvatarAction(formData: FormData) {
  const customer = await getCurrentCustomer();

  if (!customer) {
    redirect("/login");
  }

  const parsed = avatarSchema.safeParse({
    base: formData.get("base"),
    eyes: formData.get("eyes"),
    mouth: formData.get("mouth"),
    accessory: formData.get("accessory"),
    clothes: formData.get("clothes"),
    background: formData.get("background")
  });

  if (!parsed.success) {
    redirect(`/profile/avatar?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте аватар")}`);
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/profile/avatar?error=supabase");
  }

  const { error } = await supabase.from("customer_avatars").upsert(
    {
      customer_id: customer.id,
      ...parsed.data
    },
    { onConflict: "customer_id" }
  );

  if (error) {
    redirect(`/profile/avatar?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/profile?avatar=saved");
}
