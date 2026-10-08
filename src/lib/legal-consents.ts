import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { LEGAL_VERSION } from "@/lib/legal";
import { createDatabaseServerClient } from "@/lib/database/server";

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
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return null;
  }

  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function getCurrentConsentState(subjectId: string, type: ConsentType) {
  const database = createDatabaseServerClient();
  if (!database) return null;
  const { data } = await database
    .from("legal_consents")
    .select("consent_type, granted, granted_at, revoked_at, document_version, source_path, subject_id")
    .eq("subject_type", "customer")
    .eq("subject_id", subjectId)
    .eq("consent_type", type)
    .or("granted.eq.true,source_path.neq./checkout")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function recordLegalConsents(params: {
  subjectType: "customer" | "lead" | "candidate" | "anonymous";
  subjectId?: string | null;
  sourcePath: string;
  consents: Array<{ type: ConsentType; granted: boolean }>;
  userAgent?: string | null;
}) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { ok: false as const, message: "Журнал согласий недоступен." };
  }
  if (params.consents.length === 0) return { ok: true as const };

  const now = new Date().toISOString();
  for (const consent of params.consents) {
    const { data: existing } = await database
      .from("legal_consents")
      .select("granted, document_version")
      .eq("subject_type", params.subjectType)
      .eq("subject_id", params.subjectId ?? null)
      .eq("consent_type", consent.type)
      .or("granted.eq.true,source_path.neq./checkout")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.granted === consent.granted && existing.document_version === LEGAL_VERSION) continue;
    const { error } = await database.from("legal_consents").insert({
      consent_type: consent.type,
      document_version: LEGAL_VERSION,
      granted: consent.granted,
      granted_at: consent.granted ? now : null,
      revoked_at: !consent.granted && existing?.granted === true ? now : null,
      source_path: params.sourcePath,
      subject_id: params.subjectId ?? null,
      subject_type: params.subjectType,
      user_agent_short: params.userAgent ?? null
    });
    if (error) return { ok: false as const, message: "Не удалось сохранить выбор согласий." };
  }
  return { ok: true as const };
}
