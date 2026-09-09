import "server-only";

export function getOrderNotificationReturnUrl() {
  try {
    const origin = new URL(process.env.APP_ORIGIN?.trim() ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password) return null;
    return new URL("/profile/orders", origin.origin).toString();
  } catch {
    return null;
  }
}

export function getNotificationConfiguration() {
  return {
    enabled: process.env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true",
    maintenance: process.env.MAINTENANCE_MODE === "true",
    appOriginValid: Boolean(getOrderNotificationReturnUrl()),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    maxConfigured: Boolean(process.env.MAX_BOT_TOKEN?.trim())
  };
}

export type NotificationConfiguration = ReturnType<typeof getNotificationConfiguration>;
