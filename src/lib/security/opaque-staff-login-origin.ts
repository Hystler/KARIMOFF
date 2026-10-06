import { getPublicRequestOrigin } from "@/lib/request-security";

const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getOpaqueStaffLoginOriginHeaders(request: Request): Headers | null {
  const url = new URL(request.url);
  if (url.pathname !== "/admin/login" || request.method !== "POST") return null;
  if (!request.headers.has("next-action") || request.headers.get("origin")?.trim().toLowerCase() !== "null") return null;

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) return null;

  let publicOrigin: URL;
  try {
    publicOrigin = new URL(getPublicRequestOrigin(request));
  } catch {
    return null;
  }

  if (publicOrigin.protocol !== "https:" && !(publicOrigin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(publicOrigin.hostname))) {
    return null;
  }

  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    ?? firstForwardedValue(request.headers.get("host"));
  const proto = firstForwardedValue(request.headers.get("x-forwarded-proto"))
    ?? (new URL(request.url).protocol.slice(0, -1));
  if (!host || publicOrigin.host.toLowerCase() !== host.toLowerCase() || publicOrigin.protocol !== `${proto}:`) return null;

  const headers = new Headers(request.headers);
  headers.set("origin", publicOrigin.origin);
  return headers;
}
