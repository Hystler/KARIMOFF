"use server";

import { leadFormSchema, type LeadActionState } from "@/lib/lead-schema";
import { getShortUserAgent, isChecked } from "@/lib/legal-consents";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { LEGAL_VERSION } from "@/lib/legal";

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

  if ((parsed.data.interest === "career" || parsed.data.interest === "franchise")
    && !isChecked(formData.get("personal_data_consent"))) {
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
  const consentType = interest === "career" ? "careers" : interest === "franchise" ? "franchise" : null;
  const sourcePath = interest === "career" ? "/careers" : interest === "franchise" ? "/franchise" : "/";
  const { data, error } = await database.rpc("create_lead_with_consents_atomic", {
    p_name: name,
    p_phone: normalizeRussianPhone(phone),
    p_interest: interest,
    p_comment: comment || null,
    p_source: "site",
    p_consent_type: consentType,
    p_document_version: LEGAL_VERSION,
    p_source_path: sourcePath,
    p_user_agent_short: await getShortUserAgent(),
    p_marketing_granted: isChecked(formData.get("marketing_consent"))
  });

  if (error || typeof data !== "string") {
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
