const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizePublicHost(value: string | null) {
  const host = firstForwardedValue(value);
  if (!host || !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return null;
  return host;
}

function getConfiguredAppOrigin() {
  const value = process.env.APP_ORIGIN?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !isLocalHttp) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicRequestOrigin(request: Request) {
  const configuredOrigin = getConfiguredAppOrigin();
  if (configuredOrigin) return configuredOrigin;

  const internalUrl = new URL(request.url);
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : internalUrl.protocol.slice(0, -1);
  const publicHost = normalizePublicHost(request.headers.get("x-forwarded-host"))
    ?? normalizePublicHost(request.headers.get("host"));

  return publicHost ? new URL(`${protocol}://${publicHost}`).origin : internalUrl.origin;
}

export function getPublicRequestUrl(request: Request, path: string) {
  const origin = getPublicRequestOrigin(request);
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("Cross-origin redirect is not allowed.");
  return url;
}

export function isAllowedSameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return false;
  }

  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = new URL(request.url).host;
    const headerHost = request.headers.get("host");
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const allowedHosts = new Set([requestHost, headerHost, forwardedHost].filter(Boolean));

    return allowedHosts.has(originHost);
  } catch {
    return false;
  }
}
