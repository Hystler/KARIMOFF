import type { SocialProvider } from "./types";

export function sanitizeSocialRedirect(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/profile";
  return value.slice(0, 500);
}

export function buildSocialResultPath(params: {
  provider: SocialProvider;
  status: "success" | "error";
  returnTo?: string | null;
  reason?: string | null;
  linked?: boolean;
}) {
  const search = new URLSearchParams({
    status: params.status,
    provider: params.provider,
    returnTo: sanitizeSocialRedirect(params.returnTo)
  });
  if (params.reason) search.set("reason", params.reason.slice(0, 80));
  if (params.linked) search.set("linked", "1");
  return `/login/social/result?${search.toString()}`;
}
