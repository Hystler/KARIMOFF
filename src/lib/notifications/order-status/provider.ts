import "server-only";

import { z } from "zod";
import { getNotificationConfiguration, getOrderNotificationReturnUrl } from "./configuration";

export type OrderNotificationEvent = "cancelled" | "ready";
export type OrderNotificationProvider = "max" | "telegram";

export function getTelegramBotRecipientId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  return Number.isSafeInteger(Number(value)) ? value : null;
}

export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(code);
    this.name = "NotificationProviderError";
  }
}

const telegramResponseSchema = z.object({
  ok: z.boolean(),
  error_code: z.number().int().optional(),
  result: z.object({ message_id: z.number().int().positive() }).optional(),
  parameters: z.object({ retry_after: z.number().nonnegative().optional() }).optional()
}).passthrough();

const maxResponseSchema = z.object({
  message: z.object({ body: z.object({ mid: z.string().trim().min(1) }) })
});

function retryAfterSeconds(value: string | null) {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1_000) : undefined;
}

function notificationText(orderNumber: string, event: OrderNotificationEvent) {
  return event === "ready"
    ? `Заказ ${orderNumber} готов к выдаче. Ждём вас в KARIMOFF.`
    : `Заказ ${orderNumber} отменён. Подробности доступны в личном кабинете.`;
}

function classifyHttpFailure(provider: OrderNotificationProvider, status: number, retryAfterSeconds?: number) {
  if (status === 429) {
    return new NotificationProviderError(
      `${provider}_rate_limited`,
      true,
      Math.max(1, retryAfterSeconds ?? 30) * 1_000
    );
  }
  if (status === 408) {
    return new NotificationProviderError(`${provider}_outcome_unknown`, false);
  }
  if (status >= 500) {
    return new NotificationProviderError(`${provider}_temporary_failure`, true);
  }
  return new NotificationProviderError(`${provider}_delivery_rejected`, false);
}

async function sendTelegramMessage(params: {
  event: OrderNotificationEvent;
  orderNumber: string;
  recipientId: string;
  returnUrl: string;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new NotificationProviderError("telegram_not_configured", false);

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: params.recipientId,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть заказ", url: params.returnUrl }]]
        },
        text: notificationText(params.orderNumber, params.event)
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    // The server may have accepted a POST before the connection was lost.
    throw new NotificationProviderError("telegram_outcome_unknown", false);
  }

  const payload = telegramResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || (payload.success && !payload.data.ok)) {
    throw classifyHttpFailure(
      "telegram",
      payload.success && !payload.data.ok ? payload.data.error_code ?? response.status : response.status,
      payload.success ? payload.data.parameters?.retry_after : undefined
    );
  }
  if (!payload.success || !payload.data.result) {
    throw new NotificationProviderError("telegram_outcome_unknown", false);
  }
  return String(payload.data.result.message_id);
}

async function sendMaxMessage(params: {
  event: OrderNotificationEvent;
  orderNumber: string;
  recipientId: string;
  returnUrl: string;
}) {
  const token = process.env.MAX_BOT_TOKEN?.trim();
  if (!token) throw new NotificationProviderError("max_not_configured", false);

  const url = new URL("https://platform-api2.max.ru/messages");
  url.searchParams.set("user_id", params.recipientId);
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        attachments: [{
          payload: {
            buttons: [[{ text: "Открыть заказ", type: "link", url: params.returnUrl }]]
          },
          type: "inline_keyboard"
        }],
        text: notificationText(params.orderNumber, params.event)
      }),
      cache: "no-store",
      headers: {
        Authorization: token,
        "Content-Type": "application/json"
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new NotificationProviderError("max_outcome_unknown", false);
  }

  if (!response.ok) {
    throw classifyHttpFailure("max", response.status, retryAfterSeconds(response.headers.get("retry-after")));
  }
  const payload = maxResponseSchema.safeParse(await response.json().catch(() => null));
  if (!payload.success) throw new NotificationProviderError("max_outcome_unknown", false);
  return payload.data.message.body.mid;
}

export async function sendOrderStatusNotification(params: {
  event: OrderNotificationEvent;
  orderNumber: string;
  provider: OrderNotificationProvider;
  recipientId: string;
}) {
  const configuration = getNotificationConfiguration();
  if (!configuration.enabled || configuration.maintenance) {
    throw new NotificationProviderError("delivery_disabled", false);
  }
  const returnUrl = getOrderNotificationReturnUrl();
  if (!returnUrl) throw new NotificationProviderError("app_origin_not_configured", false);
  return params.provider === "telegram"
    ? sendTelegramMessage({ ...params, returnUrl })
    : sendMaxMessage({ ...params, returnUrl });
}
