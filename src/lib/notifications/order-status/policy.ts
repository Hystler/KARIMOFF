import "server-only";

import type { OrderNotificationEvent, OrderNotificationProvider } from "./provider";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function activationTime(value: string | undefined) {
  // Require an explicit UTC instant; Date.parse alone accepts malformed dates.
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === canonical
    && date.getTime() <= Date.now() ? canonical : null;
}

function telegramMode() {
  return process.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE ?? "canary";
}

export function getOrderNotificationPolicy(provider: OrderNotificationProvider) {
  const telegram = provider === "telegram";
  const permitted = telegram
    ? process.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED === "true"
    : process.env.MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED === "true";
  const notBefore = activationTime(telegram
    ? process.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE
    : process.env.MAX_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE);
  const mode = telegramMode();
  const canary = telegram && mode === "canary";
  const rawOrderId = process.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID;
  const canaryOrderId = rawOrderId && uuid.test(rawOrderId) ? rawOrderId.toLowerCase() : null;
  // A Telegram canary is exclusive: even an accidentally permitted MAX channel
  // must not process any other delivery during this one-order check.
  const exclusiveCanary = process.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED === "true" && mode !== "live";
  const modeReady = telegram ? mode === "live" || (canary && Boolean(canaryOrderId)) : !exclusiveCanary;
  return {
    enabled: process.env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true"
      && process.env.MAINTENANCE_MODE !== "true" && permitted && Boolean(notBefore) && modeReady
      && (provider === "telegram" || provider === "max"),
    notBefore,
    canary,
    canaryOrderId: canary ? canaryOrderId : null
  };
}

export type NotificationDeliveryContext = {
  event: OrderNotificationEvent;
  orderId: string;
  orderCreatedAt: Date | string;
  deliveryCreatedAt: Date | string;
};

export function isOrderNotificationAllowed(provider: OrderNotificationProvider, context: NotificationDeliveryContext) {
  const policy = getOrderNotificationPolicy(provider);
  if (!policy.enabled || !policy.notBefore || !uuid.test(context.orderId)) return false;
  if (policy.canary && (context.orderId.toLowerCase() !== policy.canaryOrderId || context.event !== "ready")) return false;
  const times = [context.orderCreatedAt, context.deliveryCreatedAt].map((value) =>
    value instanceof Date ? value.getTime() : Date.parse(activationTime(value) ?? ""));
  const start = Date.parse(policy.notBefore);
  return times.every((time) => Number.isFinite(time) && time >= start && time <= Date.now());
}
