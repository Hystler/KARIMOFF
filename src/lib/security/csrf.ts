import "server-only";

import { headers } from "next/headers";

function normalizeHost(value: string | null | undefined) {
  return value?.split(",")[0]?.trim().toLowerCase() ?? "";
}

export function isTrustedRequestOrigin(params: {
  origin: string | null;
  host: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}) {
  if (!params.origin) return process.env.NODE_ENV !== "production";

  let origin: URL;
  try {
    origin = new URL(params.origin);
  } catch {
    return false;
  }

  const expectedHost = normalizeHost(params.forwardedHost) || normalizeHost(params.host);
  const expectedProto = normalizeHost(params.forwardedProto) || (process.env.NODE_ENV === "production" ? "https" : origin.protocol.slice(0, -1));

  return origin.host.toLowerCase() === expectedHost && origin.protocol === `${expectedProto}:`;
}

export async function assertTrustedRequestOrigin() {
  const requestHeaders = await headers();
  const trusted = isTrustedRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto")
  });

  if (!trusted) {
    throw new Error("Недопустимый источник запроса.");
  }
}
