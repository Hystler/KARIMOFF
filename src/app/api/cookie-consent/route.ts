import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CookieConsentPayload = {
  accepted?: boolean;
  categories?: Record<string, boolean>;
  consentId?: string;
  pageUrl?: string;
};

export async function POST(request: Request) {
  let payload: CookieConsentPayload;

  try {
    payload = (await request.json()) as CookieConsentPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный запрос." }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const customer = await getCurrentCustomer();
  const headerStore = await headers();
  const { error } = await supabase.from("cookie_consents").insert({
    accepted: payload.accepted !== false,
    categories: payload.categories ?? { necessary: true },
    consent_id: payload.consentId ?? null,
    customer_id: customer?.id ?? null,
    ip_hash: null,
    page_url: payload.pageUrl ?? null,
    user_agent: headerStore.get("user-agent")
  });

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Cookie consent was not stored:", error.message);
    }

    return NextResponse.json({ ok: true, stored: false });
  }

  return NextResponse.json({ ok: true, stored: true });
}
