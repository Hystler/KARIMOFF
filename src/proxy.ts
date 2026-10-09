import { NextResponse, type NextRequest } from "next/server";
import {
  isMaintenanceMode,
  isReadOnlyRequest,
  MAINTENANCE_MESSAGE
} from "@/lib/maintenance";
import { getOpaqueStaffLoginOriginHeaders } from "@/lib/security/opaque-staff-login-origin";

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function adminResponseHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const stagingBlockedPrefixes = [
    "/api/auth",
    "/api/webhooks/yookassa",
    "/api/internal/evotor",
    "/api/integrations/evotor",
    "/api/terminal",
    "/api/pos"
  ];
  if (process.env.STAGING_UI_MODE === "true"
    && stagingBlockedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.json({ ok: false, error: "Operation is disabled in staging UI mode." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }

  if (process.env.STAGING_UI_MODE === "true" && !isReadOnlyRequest(request.method)) {
    const isStaffAction = isAdminPath(pathname)
      || pathname === "/kitchen"
      || pathname.startsWith("/kitchen/")
      || pathname === "/pos"
      || pathname.startsWith("/pos/");
    const isApiWrite = pathname.startsWith("/api/") && pathname !== "/api/cookie-consent";

    if (isStaffAction || isApiWrite) {
      return NextResponse.json({ ok: false, error: "Writes are disabled in staging UI mode." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      });
    }
  }

  if (isAdminPath(pathname)) {
    if (!isMaintenanceMode() || isReadOnlyRequest(request.method)) {
      const requestHeaders = getOpaqueStaffLoginOriginHeaders(request);
      if (requestHeaders) {
        return adminResponseHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
      }
      return adminResponseHeaders(NextResponse.next());
    }
  }

  if (!isMaintenanceMode() || isReadOnlyRequest(request.method)) {
    return NextResponse.next();
  }

  const acceptsJson = request.headers.get("accept")?.includes("application/json");

  if (acceptsJson || request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: MAINTENANCE_MESSAGE },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "300"
        }
      }
    );
  }

  return new NextResponse(MAINTENANCE_MESSAGE, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "300"
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|assets/).*)"]
};
