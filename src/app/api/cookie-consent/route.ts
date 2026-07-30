import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getShortUserAgent, recordLegalConsents } from "@/lib/legal-consents";
import { isAllowedSameOriginRequest } from "@/lib/request-security";
import { createDatabaseServerClient } from "@/lib/database/server";

export const runtime = "nodejs";

type CookieConsentPayload = {
  accepted?: boolean;
  categories?: Record<string, boolean>;
  consentId?: string;
  pageUrl?: string;
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > 16_384) {
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

  const database = createDatabaseServerClient();

  if (!database) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const customer = await getCurrentCustomer();
  const headerStore = await headers();
  const categories = {
    necessary: true,
    analytics: payload.categories?.analytics === true,
    marketing: payload.categories?.marketing === true
  };
  const { error } = await database.from("cookie_consents").insert({
    accepted: categories.analytics || categories.marketing,
    categories,
    consent_id:
      typeof payload.consentId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(payload.consentId)
        ? payload.consentId
        : null,
    customer_id: customer?.id ?? null,
    ip_hash: null,
    page_url: typeof payload.pageUrl === "string" && payload.pageUrl.startsWith("/") ? payload.pageUrl.slice(0, 300) : null,
    user_agent: (headerStore.get("user-agent") ?? "").slice(0, 255) || null
  });

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Cookie consent was not stored.");
    }

    return NextResponse.json({ ok: true, stored: false });
  }

  await recordLegalConsents({
    subjectId: customer?.id ?? null,
    subjectType: customer ? "customer" : "anonymous",
    sourcePath: typeof payload.pageUrl === "string" && payload.pageUrl.startsWith("/") ? payload.pageUrl.slice(0, 300) : "/",
    userAgent: await getShortUserAgent(),
    consents: [
      { type: "cookies_analytics", granted: categories.analytics },
      { type: "cookies_marketing", granted: categories.marketing }
    ]
  });

  return NextResponse.json({ ok: true, stored: true });
}
