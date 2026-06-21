"use server";

import { leadFormSchema, type LeadActionState } from "@/lib/lead-schema";
import { normalizeRussianPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createLeadAction(
  _previousState: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const parsed = leadFormSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    interest: formData.get("interest"),
    comment: formData.get("comment")
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Проверьте поля формы."
    };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Supabase env is not configured. Lead was not saved.");
    }

    return {
      status: "error",
      message: "Заявка временно не отправлена."
    };
  }

  const { name, phone, interest, comment } = parsed.data;
  const { error } = await supabase.from("leads").insert({
    name,
    phone: normalizeRussianPhone(phone),
    interest,
    comment: comment || null,
    source: "site"
  });

  if (error) {
    console.error("Failed to save lead:", error.message);

    return {
      status: "error",
      message: "Заявка временно не отправлена."
    };
  }

  return {
    status: "success",
    message: "Заявка отправлена. Мы свяжемся с вами."
  };
}
