import "server-only";

import type { OAuthBrowserBinding } from "./state-policy";

export type TelegramAuthEvent =
  | "telegram.callback.received"
  | "telegram.failed"
  | "telegram.id_token.valid"
  | "telegram.identity.resolved"
  | "telegram.redirect.success"
  | "telegram.session.created"
  | "telegram.session.readback"
  | "telegram.start"
  | "telegram.token_exchange.fail"
  | "telegram.token_exchange.start"
  | "telegram.token_exchange.success";

type TelegramAuthEventDetails = {
  attemptId: string;
  stage: string;
  browserBinding?: OAuthBrowserBinding;
  errorCode?: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  networkError?: string | null;
  providerError?: string | null;
  resolution?: "authenticated" | "linked" | "needs_phone";
};

export function logTelegramAuthEvent(event: TelegramAuthEvent, details: TelegramAuthEventDetails) {
  const entry = {
    event,
    provider: "telegram",
    attempt_id: details.attemptId,
    stage: details.stage,
    timestamp: new Date().toISOString(),
    ...(details.browserBinding ? { browser_binding: details.browserBinding } : {}),
    ...(details.errorCode ? { error_code: details.errorCode } : {}),
    ...(details.httpStatus ? { http_status: details.httpStatus } : {}),
    ...(typeof details.durationMs === "number" ? { duration_ms: Math.max(0, Math.round(details.durationMs)) } : {}),
    ...(details.networkError ? { network_error: details.networkError } : {}),
    ...(details.providerError ? { provider_error: details.providerError } : {}),
    ...(details.resolution ? { resolution: details.resolution } : {})
  };
  console.info(JSON.stringify(entry));
}
