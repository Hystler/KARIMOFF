import "server-only";

import { resolvePublicMediaUrl } from "@/lib/media-url";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { LEGAL_CONTACTS } from "@/lib/legal";

const SITE_SETTINGS_SELECT =
  "id, site_name, phone, address, working_hours, delivery_enabled, pickup_enabled, theme, loyalty_enabled, loyalty_percent, loyalty_redemption_limit_percent, payments_enabled, hero_title, hero_subtitle, home_hero_image_url, menu_hero_image_url, business_hero_image_url, careers_hero_image_url, franchise_hero_image_url, about_hero_image_url, telegram_url, tiktok_url";

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
  loyalty_redemption_limit_percent: number | null;
  payments_enabled: boolean;
  hero_title: string | null;
  hero_subtitle: string | null;
  home_hero_image_url: string | null;
  menu_hero_image_url: string | null;
  business_hero_image_url: string | null;
  careers_hero_image_url: string | null;
  franchise_hero_image_url: string | null;
  about_hero_image_url: string | null;
  telegram_url: string | null;
  tiktok_url: string | null;
};

export const fallbackSiteSettings: SiteSettings = {
  id: "main",
  site_name: "KARIMOFF",
  phone: LEGAL_CONTACTS.supportPhone,
  address: null,
  working_hours: null,
  delivery_enabled: true,
  pickup_enabled: true,
  theme: "light",
  loyalty_enabled: true,
  loyalty_percent: 10,
  loyalty_redemption_limit_percent: null,
  payments_enabled: false,
  hero_title: null,
  hero_subtitle: null,
  home_hero_image_url: null,
  menu_hero_image_url: null,
  business_hero_image_url: null,
  careers_hero_image_url: null,
  franchise_hero_image_url: null,
  about_hero_image_url: null,
  telegram_url: "https://t.me/juikaifui",
  tiktok_url: "https://www.tiktok.com/@karimich_11.0"
};

function optionalString(row: Record<string, unknown>, key: string) {
  return typeof row[key] === "string" && row[key].length > 0 ? String(row[key]) : null;
}

function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function sanitizePublicContactPhone(value: string | null | undefined) {
  const configured = value?.trim() || null;
  const configuredDigits = phoneDigits(configured);
  const adminDigits = phoneDigits(process.env.ADMIN_PHONE);

  if (!configuredDigits || (adminDigits && configuredDigits === adminDigits)) {
    return LEGAL_CONTACTS.supportPhone;
  }

  return configured;
}

function normalizeSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) {
    return fallbackSiteSettings;
  }

  return {
    id: String(row.id ?? "main"),
    site_name: String(row.site_name ?? fallbackSiteSettings.site_name),
    phone: sanitizePublicContactPhone(typeof row.phone === "string" ? row.phone : null),
    address: typeof row.address === "string" && row.address.length > 0 ? row.address : null,
    working_hours: typeof row.working_hours === "string" && row.working_hours.length > 0 ? row.working_hours : null,
    delivery_enabled: row.delivery_enabled !== false,
    pickup_enabled: row.pickup_enabled !== false,
    theme: row.theme === "dark" ? "dark" : "light",
    loyalty_enabled: row.loyalty_enabled !== false,
    loyalty_percent: Number(row.loyalty_percent ?? fallbackSiteSettings.loyalty_percent),
    loyalty_redemption_limit_percent:
      row.loyalty_redemption_limit_percent === null || row.loyalty_redemption_limit_percent === undefined
        ? null
        : Number(row.loyalty_redemption_limit_percent),
    payments_enabled: false,
    hero_title: optionalString(row, "hero_title"),
    hero_subtitle: optionalString(row, "hero_subtitle"),
    home_hero_image_url: resolvePublicMediaUrl(optionalString(row, "home_hero_image_url")),
    menu_hero_image_url: resolvePublicMediaUrl(optionalString(row, "menu_hero_image_url")),
    business_hero_image_url: resolvePublicMediaUrl(optionalString(row, "business_hero_image_url")),
    careers_hero_image_url: resolvePublicMediaUrl(optionalString(row, "careers_hero_image_url")),
    franchise_hero_image_url: resolvePublicMediaUrl(optionalString(row, "franchise_hero_image_url")),
    about_hero_image_url: resolvePublicMediaUrl(optionalString(row, "about_hero_image_url")),
    telegram_url: optionalString(row, "telegram_url"),
    tiktok_url: optionalString(row, "tiktok_url")
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const database = createDatabaseServerClient();

  if (!database) {
    return fallbackSiteSettings;
  }

  const { data, error } = await database.from("site_settings").select(SITE_SETTINGS_SELECT).eq("id", "main").maybeSingle();

  if (error || !data) {
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("Site settings fallback is used:", error.message);
    }
    return fallbackSiteSettings;
  }

  return normalizeSettings(data);
}

export async function getAdminSiteSettings() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      settings: fallbackSiteSettings,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await database.from("site_settings").select(SITE_SETTINGS_SELECT).eq("id", "main").maybeSingle();

  return {
    settings: normalizeSettings(data),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "site_settings")
  };
}
