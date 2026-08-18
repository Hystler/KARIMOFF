import "server-only";

import type { SocialProvider } from "./types";

type ProviderConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
};

function validRedirectUri(value: string | undefined, provider: SocialProvider) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.pathname !== `/api/auth/social/${provider}/callback`) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getSocialProviderConfig(provider: SocialProvider): ProviderConfig | null {
  if (provider === "telegram") {
    const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID?.trim();
    const clientSecret = process.env.TELEGRAM_OIDC_CLIENT_SECRET?.trim();
    const redirectUri = validRedirectUri(process.env.TELEGRAM_OIDC_REDIRECT_URI?.trim(), "telegram");
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
  }

  const clientId = process.env.VK_ID_CLIENT_ID?.trim();
  const redirectUri = validRedirectUri(process.env.VK_ID_REDIRECT_URI?.trim(), "vk");
  return clientId && redirectUri ? { clientId, redirectUri } : null;
}

export function isSocialProviderConfigured(provider: SocialProvider) {
  return Boolean(getSocialProviderConfig(provider));
}

export function getConfiguredSocialProviders() {
  return {
    telegram: isSocialProviderConfigured("telegram"),
    vk: isSocialProviderConfigured("vk")
  };
}

export function shouldRequestSocialPhone() {
  return process.env.SOCIAL_AUTH_REQUEST_PHONE === "true";
}
