import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getCustomerSession } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";

const allowedHostSuffixes = [".telesco.pe", ".telegram.org", ".userapi.com", ".vkuserphoto.ru"];
const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function isAllowedAvatarUrl(value: string, provider: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (provider === "telegram") return allowedHostSuffixes.slice(0, 2).some((suffix) => url.hostname.endsWith(suffix));
    if (provider === "vk") return allowedHostSuffixes.slice(2).some((suffix) => url.hostname.endsWith(suffix));
    return false;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const identityId = request.nextUrl.searchParams.get("identity") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(identityId)) return new NextResponse(null, { status: 400 });
  const [customer, staff] = await Promise.all([getCustomerSession(), getCurrentStaff()]);
  const privilegedStaff = staff && ["owner", "admin", "manager"].includes(staff.role);
  if (!customer && !privilegedStaff) return new NextResponse(null, { status: 401 });
  const database = createDatabaseServerClient();
  if (!database) return new NextResponse(null, { status: 503 });
  const { data } = await database
    .from("user_identities")
    .select("user_id, provider, avatar_url")
    .eq("id", identityId)
    .maybeSingle();
  if (!data?.avatar_url || (!privilegedStaff && String(data.user_id) !== customer?.customerId)) {
    return new NextResponse(null, { status: 404 });
  }
  const avatarUrl = String(data.avatar_url);
  if (!isAllowedAvatarUrl(avatarUrl, String(data.provider))) return new NextResponse(null, { status: 400 });

  try {
    const response = await fetch(avatarUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" }
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !allowedContentTypes.has(contentType) || contentLength > MAX_AVATAR_BYTES) {
      return new NextResponse(null, { status: 502 });
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_AVATAR_BYTES) return new NextResponse(null, { status: 502 });
    return new NextResponse(body, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
