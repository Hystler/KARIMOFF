import "server-only";

import {
  inspectMaxAuthEnvironment,
  type MaxAuthConfig,
  type MaxAuthDiagnostics
} from "@/lib/auth/social/max-config-state";

export type TelegramLoginLibraryConfig = {
  clientId: string;
  clientIdNumber: number;
};

export type { MaxAuthConfig, MaxAuthDiagnostics } from "@/lib/auth/social/max-config-state";

const loggedMaxDiagnostics = new Set<string>();

export function getTelegramLoginLibraryConfig(): TelegramLoginLibraryConfig | null {
  const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID?.trim();
  if (!clientId || !/^\d{1,16}$/.test(clientId)) return null;

  const clientIdNumber = Number(clientId);
  if (!Number.isSafeInteger(clientIdNumber) || clientIdNumber <= 0) return null;

  return { clientId, clientIdNumber };
}

export function getMaxAuthConfig(): MaxAuthConfig | null {
  return inspectMaxAuthEnvironment(process.env).config;
}

export function getMaxAuthDiagnostics(): MaxAuthDiagnostics {
  return inspectMaxAuthEnvironment(process.env).diagnostics;
}

export function logMaxAuthDiagnostics(context: "login" | "mini_app" | "start") {
  const diagnostics = getMaxAuthDiagnostics();
  const fingerprint = `${context}:${JSON.stringify(diagnostics)}`;
  if (loggedMaxDiagnostics.has(fingerprint)) return diagnostics;
  loggedMaxDiagnostics.add(fingerprint);
  console.info(JSON.stringify({
    event: "max.auth.configuration",
    context,
    ...diagnostics
  }));
  return diagnostics;
}

export function getConfiguredSocialProviders() {
  return {
    telegram: Boolean(getTelegramLoginLibraryConfig()),
    max: Boolean(getMaxAuthConfig())
  };
}
