import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SiteTheme = "light" | "dark";

export type SiteSettings = {
  id: string;
  site_name: string;
  phone: string | null;
  address: string | null;
  working_hours: string | null;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  theme: SiteTheme;
  loyalty_enabled: boolean;
  loyalty_percent: number;
  hero_title: string | null;
  hero_subtitle: string | null;
};

export const fallbackSiteSettings: SiteSettings = {
  id: "main",
  site_name: "KARIMOFF",
  phone: null,
  address: null,
  working_hours: null,
  delivery_enabled: true,
  pickup_enabled: true,
  theme: "light",
  loyalty_enabled: true,
  loyalty_percent: 5,
  hero_title: null,
  hero_subtitle: null
};

function normalizeSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) {
    return fallbackSiteSettings;
  }

  return {
    id: String(row.id ?? "main"),
    site_name: String(row.site_name ?? fallbackSiteSettings.site_name),
    phone: typeof row.phone === "string" && row.phone.length > 0 ? row.phone : null,
    address: typeof row.address === "string" && row.address.length > 0 ? row.address : null,
    working_hours: typeof row.working_hours === "string" && row.working_hours.length > 0 ? row.working_hours : null,
    delivery_enabled: row.delivery_enabled !== false,
    pickup_enabled: row.pickup_enabled !== false,
    theme: row.theme === "dark" ? "dark" : "light",
    loyalty_enabled: row.loyalty_enabled !== false,
    loyalty_percent: Number(row.loyalty_percent ?? fallbackSiteSettings.loyalty_percent),
    hero_title: typeof row.hero_title === "string" && row.hero_title.length > 0 ? row.hero_title : null,
    hero_subtitle: typeof row.hero_subtitle === "string" && row.hero_subtitle.length > 0 ? row.hero_subtitle : null
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return fallbackSiteSettings;
  }

  const { data, error } = await supabase.from("site_settings").select("*").eq("id", "main").maybeSingle();

  if (error || !data) {
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("Site settings fallback is used:", error.message);
    }
    return fallbackSiteSettings;
  }

  return normalizeSettings(data);
}

export async function getAdminSiteSettings() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      settings: fallbackSiteSettings,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase.from("site_settings").select("*").eq("id", "main").maybeSingle();

  return {
    settings: normalizeSettings(data),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "site_settings", "supabase/settings.sql")
  };
}
