import "server-only";

import { z } from "zod";
import { normalizeRussianPhone } from "@/lib/phone";
import { getSocialProviderConfig, shouldRequestSocialPhone } from "./config";
import type { SocialIdentityClaims } from "./types";

const VK_AUTHORIZE_URL = "https://id.vk.ru/authorize";
const VK_TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const VK_USER_INFO_URL = "https://id.vk.ru/oauth2/user_info";

const tokenSchema = z.object({
  access_token: z.string().min(20),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  user_id: z.union([z.string(), z.number()]).optional()
});

const userSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  avatar: z.string().url().max(2048).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().max(320).optional()
});

const userInfoSchema = z.object({ user: userSchema });

export function getVkAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
}) {
  const config = getSocialProviderConfig("vk");
  if (!config) throw new Error("VK ID authentication is not configured.");
  const query: Record<string, string> = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "s256"
  };
  if (shouldRequestSocialPhone()) query.scope = "phone";
  const url = new URL(VK_AUTHORIZE_URL);
  url.search = new URLSearchParams(query).toString();
  return url;
}

export async function exchangeVkCode(params: {
  code: string;
  deviceId: string;
  state: string;
  codeVerifier: string;
}): Promise<SocialIdentityClaims> {
  const config = getSocialProviderConfig("vk");
  if (!config) throw new Error("VK ID authentication is not configured.");

  const tokenUrl = new URL(VK_TOKEN_URL);
  tokenUrl.search = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: params.codeVerifier,
    state: params.state,
    device_id: params.deviceId
  }).toString();
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: params.code }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!tokenResponse.ok) throw new Error("VK ID authorization was rejected.");
  const token = tokenSchema.parse(await tokenResponse.json());

  const userInfoUrl = new URL(VK_USER_INFO_URL);
  userInfoUrl.searchParams.set("client_id", config.clientId);
  const profileResponse = await fetch(userInfoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token.access_token }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!profileResponse.ok) throw new Error("VK ID profile is unavailable.");
  const profile = userInfoSchema.parse(await profileResponse.json()).user;
  const normalizedPhone = profile.phone ? normalizeRussianPhone(profile.phone) : "";
  const phone = /^\+7\d{10}$/.test(normalizedPhone) ? normalizedPhone : null;
  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null;

  return {
    provider: "vk",
    providerUserId: String(profile.user_id),
    username: null,
    displayName,
    avatarUrl: profile.avatar ?? null,
    email: profile.email ?? null,
    phone,
    phoneVerified: false,
    metadata: {}
  };
}
