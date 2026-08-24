const CONTROL_HOST = "control.karimoff.site";

function normalizeHostname(value: string | null | undefined) {
  const first = value?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname;
  } catch {
    return "";
  }
}

function appOriginHostname(appOrigin: string | null | undefined) {
  if (!appOrigin) return "";
  try {
    return new URL(appOrigin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export function isAdminHostAllowed(params: {
  host: string | null | undefined;
  appOrigin?: string | null;
  nodeEnv?: string;
  testOrderMode?: string;
}) {
  const hostname = normalizeHostname(params.host);
  if (hostname === CONTROL_HOST) return true;

  if (params.nodeEnv !== "production" && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return true;
  }

  const testHostname = appOriginHostname(params.appOrigin);
  return Boolean(
    params.testOrderMode === "true" &&
    testHostname.endsWith(".twc1.net") &&
    hostname === testHostname
  );
}

export function requestHostname(headers: Headers, fallbackHost = "") {
  return headers.get("x-forwarded-host") || headers.get("host") || fallbackHost;
}

export const ADMIN_CONTROL_HOST = CONTROL_HOST;
