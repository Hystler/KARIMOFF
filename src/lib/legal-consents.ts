import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { LEGAL_VERSION } from "@/lib/legal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConsentType =
  | "personal_data"
  | "marketing"
  | "franchise"
  | "careers"
  | "cookies_analytics"
  | "cookies_marketing"
  | "offer_acceptance"
  | "loyalty_rules";

export function isChecked(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1";
}

export async function getShortUserAgent() {
  const headerStore = await headers();
  return (headerStore.get("user-agent") ?? "").slice(0, 255) || null;
}

export function hashPrivacyValue(value: string) {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    return null;
  }

  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function recordLegalConsents(params: {
  subjectType: "customer" | "lead" | "candidate" | "anonymous";
  subjectId?: string | null;
  sourcePath: string;
  consents: Array<{ type: ConsentType; granted: boolean }>;
  userAgent?: string | null;
}) {
  const supabase = createSupabaseServerClient();

  if (!supabase || params.consents.length === 0) {
    return { ok: false as const, message: "Журнал согласий недоступен." };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("legal_consents").insert(
    params.consents.map((consent) => ({
      consent_type: consent.type,
      document_version: LEGAL_VERSION,
      granted: consent.granted,
      granted_at: consent.granted ? now : null,
      revoked_at: consent.granted ? null : now,
      source_path: params.sourcePath,
      subject_id: params.subjectId ?? null,
      subject_type: params.subjectType,
      user_agent_short: params.userAgent ?? null
    }))
  );

  return error
    ? { ok: false as const, message: "Не удалось сохранить выбор согласий." }
    : { ok: true as const };
}
