import { isLiveReadonlyStaging } from "@/lib/staging-access";
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
  if (isLiveReadonlyStaging()) return stagingProxy(request);



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

async function stagingProxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { getStaffForSessionToken } = await import("@/lib/admin-auth");
    const read = isReadOnlyRequest(request.method);
    const login = pathname === "/admin/login";
    const health = pathname === "/api/health" && read;
    const forbiddenApi = pathname.startsWith("/api/") && !health
      && !/^\/api\/admin\/(?:analytics\/(?:performance|report\/export|sales\/export)|products\/[0-9a-f-]{36}\/images)$/.test(pathname);
    if (forbiddenApi || (!read && !login)) return adminResponseHeaders(NextResponse.json({ok:false,error:"Staging is read-only."},{status:403}));
    if (!login && !health) {
      const staff = await getStaffForSessionToken(request.cookies.get("karimoff_admin_session")?.value);
      if (!staff?.legacy) {
        if (pathname.startsWith("/api/")) return adminResponseHeaders(NextResponse.json({ok:false},{status:401}));
        return adminResponseHeaders(NextResponse.redirect(new URL("/admin/login", request.url)));
      }
    }
    const headers = getOpaqueStaffLoginOriginHeaders(request);
    return adminResponseHeaders(headers ? NextResponse.next({request:{headers}}) : NextResponse.next());
  }
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|assets/).*)"]
};
