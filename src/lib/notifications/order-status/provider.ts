import "server-only";

import { z } from "zod";

export type OrderNotificationEvent = "cancelled" | "ready";
export type OrderNotificationProvider = "max" | "telegram";

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
  result: z.object({ message_id: z.number() }).optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional()
}).passthrough();

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
  if (status >= 500 || status === 408) {
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
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new NotificationProviderError("telegram_network_failure", true);
  }

  const payload = telegramResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !payload.success || !payload.data.ok) {
    throw classifyHttpFailure("telegram", response.status, payload.success ? payload.data.parameters?.retry_after : undefined);
  }
  return String(payload.data.result?.message_id ?? "");
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
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new NotificationProviderError("max_network_failure", true);
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw classifyHttpFailure("max", response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  const payload = await response.json().catch(() => null) as {
    body?: { mid?: string };
    message_id?: string;
  } | null;
  return String(payload?.body?.mid ?? payload?.message_id ?? "");
}

export async function sendOrderStatusNotification(params: {
  event: OrderNotificationEvent;
  orderNumber: string;
  provider: OrderNotificationProvider;
  recipientId: string;
}) {
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!appOrigin) throw new NotificationProviderError("app_origin_not_configured", false);
  const returnUrl = new URL("/profile/orders", appOrigin).toString();
  return params.provider === "telegram"
    ? sendTelegramMessage({ ...params, returnUrl })
    : sendMaxMessage({ ...params, returnUrl });
}
