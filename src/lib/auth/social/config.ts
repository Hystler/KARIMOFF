import "server-only";

export type TelegramLoginLibraryConfig = {
  clientId: string;
  clientIdNumber: number;
};

export type MaxAuthConfig = {
  botName: string;
  botToken: string;
  miniAppUrl: string;
};

export function getTelegramLoginLibraryConfig(): TelegramLoginLibraryConfig | null {
  const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID?.trim();
  if (!clientId || !/^\d{1,16}$/.test(clientId)) return null;

  const clientIdNumber = Number(clientId);
  if (!Number.isSafeInteger(clientIdNumber) || clientIdNumber <= 0) return null;

  return { clientId, clientIdNumber };
}

export function getMaxAuthConfig(): MaxAuthConfig | null {
  const botToken = process.env.MAX_BOT_TOKEN?.trim();
  const botName = process.env.MAX_BOT_NAME?.trim();
  const miniAppUrl = process.env.MAX_MINI_APP_URL?.trim();
  if (!botToken || !botName || !miniAppUrl || !/^[A-Za-z0-9_]{3,64}$/.test(botName)) return null;

  try {
    const url = new URL(miniAppUrl);
    if (url.protocol !== "https:" || url.pathname !== "/integrations/max/app" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return { botName, botToken, miniAppUrl: url.toString() };
  } catch {
    return null;
  }
}

export function getConfiguredSocialProviders() {
  return {
    telegram: Boolean(getTelegramLoginLibraryConfig()),
    max: Boolean(getMaxAuthConfig())
  };
}
