import { NextResponse, type NextRequest } from "next/server";
import {
  isMaintenanceMode,
  isReadOnlyRequest,
  MAINTENANCE_MESSAGE
} from "@/lib/maintenance";

export function proxy(request: NextRequest) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"]
};
