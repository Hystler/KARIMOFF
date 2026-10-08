import { getCurrentCustomer } from "@/lib/customer-auth";
import { LEGAL_VERSION } from "@/lib/legal";
import { isAllowedSameOriginRequest } from "@/lib/request-security";
import { getPostgresSql } from "@/lib/postgres/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CookieConsentPayload = {
  categories?: Record<string, boolean>;
  consentId?: string;
  pageUrl?: string;
};

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return NextResponse.json({ ok: false, error: "Запрос слишком большой." }, { status: 413 });
  }
  if (!isAllowedSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "Недопустимый источник запроса." }, { status: 403 });
  }

  let payload: CookieConsentPayload;
  try {
    payload = (await request.json()) as CookieConsentPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный запрос." }, { status: 400 });
  }

  if (!payload.categories || typeof payload.categories !== "object") {
    return NextResponse.json({ ok: false, error: "Не выбраны категории cookies." }, { status: 400 });
  }

  const consentId = typeof payload.consentId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(payload.consentId)
    ? payload.consentId
    : null;
  if (!consentId) return NextResponse.json({ ok: false, error: "Не удалось подтвердить выбор." }, { status: 400 });

  const customer = await getCurrentCustomer();
  const categories = {
    necessary: true,
    analytics: payload.categories.analytics === true,
    marketing: payload.categories.marketing === true
  };
  const pageUrl = typeof payload.pageUrl === "string" && payload.pageUrl.startsWith("/")
    ? payload.pageUrl.slice(0, 300)
    : "/";
  const userAgent = request.headers.get("user-agent")?.slice(0, 255) || null;

  try {
    const sql = getPostgresSql();
    await sql.begin(async (tx) => {
      const previous = await tx<{ id: string; categories: Record<string, boolean>; document_version: string }[]>`
        select id, categories, document_version
        from public.cookie_consents
        where consent_id = ${consentId}
        order by created_at desc
        limit 1
        for update
      `;
      const changed = !previous[0]
        || previous[0].document_version !== LEGAL_VERSION
        || previous[0].categories?.analytics !== categories.analytics
        || previous[0].categories?.marketing !== categories.marketing;
      let cookieSubjectId = previous[0]?.id ?? null;

      if (changed) {
        const [inserted] = await tx<{ id: string }[]>`
          insert into public.cookie_consents (
            consent_id, customer_id, accepted, categories, user_agent, page_url, ip_hash, document_version
          ) values (
            ${consentId}, ${customer?.id ?? null}::uuid,
            ${categories.analytics || categories.marketing}, ${tx.json(categories)},
            ${userAgent}, ${pageUrl}, null, ${LEGAL_VERSION}
          )
          returning id
        `;
        cookieSubjectId = inserted?.id ?? null;
      }
      if (!customer && !cookieSubjectId) throw new Error("Cookie evidence subject is missing.");
      const subjectId = customer?.id ?? cookieSubjectId;
      for (const [type, granted] of [
        ["cookies_analytics", categories.analytics],
        ["cookies_marketing", categories.marketing]
      ] as const) {
        const current = await tx<{ granted: boolean; document_version: string }[]>`
          select granted, document_version from public.legal_consents
          where subject_type = ${customer ? "customer" : "anonymous"}
            and subject_id is not distinct from ${subjectId}::uuid
            and consent_type = ${type}
          order by created_at desc limit 1 for update
        `;
        if (current[0]?.granted === granted && current[0]?.document_version === LEGAL_VERSION) continue;
        await tx`
          insert into public.legal_consents (
            subject_type, subject_id, consent_type, document_version, granted,
            granted_at, revoked_at, source_path, user_agent_short
          ) values (
            ${customer ? "customer" : "anonymous"}, ${subjectId}::uuid, ${type},
            ${LEGAL_VERSION}, ${granted}, case when ${granted} then now() else null end,
            case when ${granted} then null
              when ${current[0]?.granted === true} then now() else null end,
            ${pageUrl}, ${userAgent}
          )
        `;
      }
    });
  } catch {
    return NextResponse.json({ ok: false, stored: false, error: "Не удалось сохранить настройки. Попробуйте ещё раз." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, stored: true });
}
