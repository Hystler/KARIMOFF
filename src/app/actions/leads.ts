"use server";

import { leadFormSchema, type LeadActionState } from "@/lib/lead-schema";
import { getShortUserAgent, isChecked, recordLegalConsents } from "@/lib/legal-consents";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";

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

  if (!isChecked(formData.get("personal_data_consent"))) {
    return {
      status: "error",
      message: "Нужно дать отдельное согласие на обработку персональных данных."
    };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Database env is not configured. Lead was not saved.");
    }

    return {
      status: "error",
      message: "Заявка временно не отправлена."
    };
  }

  const { name, phone, interest, comment } = parsed.data;
  const { data, error } = await database
    .from("leads")
    .insert({
      name,
      phone: normalizeRussianPhone(phone),
      interest,
      comment: comment || null,
      source: "site"
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      status: "error",
      message: "Заявка временно не отправлена."
    };
  }

  const consentType = interest === "career" ? "careers" : interest === "franchise" ? "franchise" : "personal_data";
  const consents = await recordLegalConsents({
    subjectId: String(data.id),
    subjectType: interest === "career" ? "candidate" : "lead",
    sourcePath: interest === "career" ? "/careers" : interest === "franchise" ? "/franchise" : "/",
    userAgent: await getShortUserAgent(),
    consents: [
      { type: consentType, granted: true },
      { type: "marketing", granted: isChecked(formData.get("marketing_consent")) }
    ]
  });

  if (!consents.ok) {
    await database.from("leads").delete().eq("id", data.id);
    return { status: "error", message: consents.message };
  }

  return {
    status: "success",
    message: "Заявка отправлена. Мы свяжемся с вами."
  };
}
