export type MaxAuthConfig = {
  botName: string;
  botToken: string;
  miniAppUrl: string;
};

export type MaxAuthDiagnosticReason =
  | "configured"
  | "missing_bot_token"
  | "missing_bot_name"
  | "missing_mini_app_url"
  | "invalid_bot_name"
  | "invalid_mini_app_url"
  | "mini_app_url_requires_https"
  | "mini_app_url_path_mismatch"
  | "mini_app_url_has_credentials"
  | "mini_app_url_has_query_or_hash";

export type MaxAuthDiagnostics = {
  maxConfigured: boolean;
  hasBotToken: boolean;
  hasBotName: boolean;
  hasMiniAppUrl: boolean;
  effectiveBotName: string | null;
  reason: MaxAuthDiagnosticReason;
};

type MaxAuthEnvironment = Record<string, string | undefined>;

type MaxAuthInspection = {
  config: MaxAuthConfig | null;
  diagnostics: MaxAuthDiagnostics;
};

function maskBotName(botName: string) {
  if (botName.length <= 4) return "*".repeat(botName.length);
  return `${botName.slice(0, 2)}...${botName.slice(-4)}`;
}

function unavailable(
  reason: Exclude<MaxAuthDiagnosticReason, "configured">,
  values: { botName: string; botToken: string; miniAppUrl: string }
): MaxAuthInspection {
  return {
    config: null,
    diagnostics: {
      maxConfigured: false,
      hasBotToken: Boolean(values.botToken),
      hasBotName: Boolean(values.botName),
      hasMiniAppUrl: Boolean(values.miniAppUrl),
      effectiveBotName: values.botName ? maskBotName(values.botName) : null,
      reason
    }
  };
}

export function inspectMaxAuthEnvironment(environment: MaxAuthEnvironment): MaxAuthInspection {
  const botToken = environment.MAX_BOT_TOKEN?.trim() ?? "";
  const botName = environment.MAX_BOT_NAME?.trim() ?? "";
  const miniAppUrl = environment.MAX_MINI_APP_URL?.trim() ?? "";
  const values = { botName, botToken, miniAppUrl };

  if (!botToken) return unavailable("missing_bot_token", values);
  if (!botName) return unavailable("missing_bot_name", values);
  if (!miniAppUrl) return unavailable("missing_mini_app_url", values);
  if (!/^[A-Za-z0-9_]{3,64}$/.test(botName)) return unavailable("invalid_bot_name", values);

  let url: URL;
  try {
    url = new URL(miniAppUrl);
  } catch {
    return unavailable("invalid_mini_app_url", values);
  }

  if (url.protocol !== "https:") return unavailable("mini_app_url_requires_https", values);
  if (url.pathname !== "/integrations/max/app") return unavailable("mini_app_url_path_mismatch", values);
  if (url.username || url.password) return unavailable("mini_app_url_has_credentials", values);
  if (url.search || url.hash) return unavailable("mini_app_url_has_query_or_hash", values);

  return {
    config: { botName, botToken, miniAppUrl: url.toString() },
    diagnostics: {
      maxConfigured: true,
      hasBotToken: true,
      hasBotName: true,
      hasMiniAppUrl: true,
      effectiveBotName: maskBotName(botName),
      reason: "configured"
    }
  };
}
