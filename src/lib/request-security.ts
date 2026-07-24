const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

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
