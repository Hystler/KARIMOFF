import { NextRequest, NextResponse } from "next/server";
import { getResumableMaxChallenge } from "@/lib/auth/social/max-challenge";
import { isAllowedSameOriginRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAllowedSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const challenge = await getResumableMaxChallenge();
  return NextResponse.json(
    challenge ? { ok: true, challenge } : { ok: true, challenge: null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
