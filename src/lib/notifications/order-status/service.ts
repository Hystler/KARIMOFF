import "server-only";

import { logOperationalError, logOperationalEvent } from "@/lib/observability";
import { getPostgresSql } from "@/lib/postgres/server";
import { getNotificationConfiguration } from "./configuration";
import {
  NotificationProviderError,
  getTelegramBotRecipientId,
  sendOrderStatusNotification,
  type OrderNotificationEvent,
  type OrderNotificationProvider
} from "./provider";

type ClaimedDelivery = {
  attempts: number;
  event_type: OrderNotificationEvent;
  id: string;
  order_id: string;
  provider: OrderNotificationProvider;
  provider_user_id: string;
};

export function areOrderStatusNotificationsEnabled() {
  return process.env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true"
    && process.env.MAINTENANCE_MODE !== "true";
}

export function getOrderNotificationRetryDelay(attempt: number) {
  const schedule = [15, 30, 60, 300, 900, 3_600];
  return schedule[Math.min(schedule.length - 1, Math.max(0, attempt - 1))];
}

async function claimDueDeliveries(limit: number) {
  const sql = getPostgresSql();
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const maxConfigured = Boolean(process.env.MAX_BOT_TOKEN?.trim());
  if (!telegramConfigured && !maxConfigured) return [] as ClaimedDelivery[];

  // An expired POST lease is not proof of non-delivery. Never send it again blindly.
  await sql`
    update public.order_notification_deliveries
    set status = 'permanent_failure', last_error_code = 'delivery_outcome_unknown',
        locked_at = null, updated_at = now()
    where (status = 'processing'
      and (locked_at is null or locked_at < now() - interval '5 minutes'))
      or (status in ('pending', 'retry') and (
        last_error_code in ('telegram_network_failure', 'max_network_failure',
          'telegram_unknown_failure', 'max_unknown_failure')
        or sent_at is not null or provider_message_id is not null
      ))
  `;
  await sql`
    update public.order_notification_deliveries
    set status = 'permanent_failure', last_error_code = 'attempts_exhausted',
        locked_at = null, updated_at = now()
    where status in ('pending', 'retry') and attempts >= 8
  `;

  return sql<ClaimedDelivery[]>`
    with due as (
      select delivery.id
      from public.order_notification_deliveries delivery
      where delivery.status in ('pending', 'retry')
        and delivery.attempts < 8
        and delivery.sent_at is null and delivery.provider_message_id is null
        and delivery.available_at <= now()
        and (
          (${telegramConfigured} and delivery.provider = 'telegram')
          or (${maxConfigured} and delivery.provider = 'max')
        )
      order by delivery.available_at, delivery.created_at
      for update skip locked
      limit ${Number.isFinite(limit) ? Math.max(1, Math.min(25, Math.trunc(limit))) : 10}
    )
    update public.order_notification_deliveries delivery
    set status = 'processing',
        attempts = delivery.attempts + 1,
        locked_at = now(),
        updated_at = now()
    from due
    where delivery.id = due.id
    returning delivery.id, delivery.order_id, delivery.provider,
      delivery.provider_user_id, delivery.event_type, delivery.attempts
  `;
}

async function markSuperseded(delivery: ClaimedDelivery) {
  const sql = getPostgresSql();
  await sql`
    update public.order_notification_deliveries
    set status = 'superseded', locked_at = null, updated_at = now()
    where id = ${delivery.id}::uuid and status = 'processing' and attempts = ${delivery.attempts}
  `;
}

async function markSent(delivery: ClaimedDelivery, providerMessageId: string) {
  const sql = getPostgresSql();
  await sql`
    update public.order_notification_deliveries
    set status = 'sent', sent_at = now(), provider_message_id = ${providerMessageId || null},
        last_error_code = null, locked_at = null, updated_at = now()
    where id = ${delivery.id}::uuid and attempts = ${delivery.attempts}
      and (status = 'processing'
        or (status = 'permanent_failure' and last_error_code = 'delivery_outcome_unknown'))
  `;
}

async function markFailed(delivery: ClaimedDelivery, error: NotificationProviderError) {
  const sql = getPostgresSql();
  const exhausted = delivery.attempts >= 8;
  const permanent = !error.retryable || exhausted;
  const retrySeconds = Math.ceil(Math.max(
    error.retryAfterMs ?? 0,
    getOrderNotificationRetryDelay(delivery.attempts) * 1_000
  ) / 1_000);
  await sql`
    update public.order_notification_deliveries
    set status = ${permanent ? "permanent_failure" : "retry"},
        available_at = case
          when ${permanent} then available_at
          else now() + (${retrySeconds} * interval '1 second')
        end,
        last_error_code = ${error.code},
        locked_at = null,
        updated_at = now()
    where id = ${delivery.id}::uuid and status = 'processing' and attempts = ${delivery.attempts}
  `;
}

async function processDelivery(delivery: ClaimedDelivery) {
  if (!areOrderStatusNotificationsEnabled()) return "skipped" as const;
  const sql = getPostgresSql();
  const [order] = await sql<{
    display_number: string;
    telegram_bot_user_id: string | null;
    kitchen_status: string;
  }[]>`
    select order_row.display_number, order_row.kitchen_status,
      identity_row.metadata->>'telegramBotUserId' as telegram_bot_user_id
    from public.orders order_row
    join public.order_notification_deliveries delivery
      on delivery.order_id = order_row.id
    join public.user_identities identity_row
      on identity_row.id = delivery.identity_id
     and identity_row.provider = delivery.provider
     and identity_row.provider_user_id = delivery.provider_user_id
     and identity_row.user_id = delivery.customer_id
     and identity_row.user_id = order_row.customer_id
    where delivery.id = ${delivery.id}::uuid
      and delivery.status = 'processing'
      and delivery.attempts = ${delivery.attempts}
      and delivery.locked_at >= now() - interval '5 minutes'
      and order_row.is_test = false
  `;
  const stillRelevant = delivery.event_type === "ready"
    ? order?.kitchen_status === "ready"
    : order?.kitchen_status === "cancelled";
  if (!order || !stillRelevant) {
    await markSuperseded(delivery);
    return "superseded" as const;
  }

  // OIDC sub identifies the login, not the Bot API recipient. Never fall back to it.
  const recipientId = delivery.provider === "telegram"
    ? getTelegramBotRecipientId(order.telegram_bot_user_id)
    : delivery.provider_user_id;
  if (!recipientId) {
    await markFailed(delivery, new NotificationProviderError("telegram_recipient_unverified", false));
    return "failed" as const;
  }

  let providerMessageId: string;
  try {
    providerMessageId = await sendOrderStatusNotification({
      event: delivery.event_type,
      orderNumber: order.display_number,
      provider: delivery.provider,
      recipientId
    });
  } catch (error) {
    const safeError = error instanceof NotificationProviderError
      ? error
      : new NotificationProviderError(`${delivery.provider}_outcome_unknown`, false);
    await markFailed(delivery, safeError);
    return safeError.retryable && delivery.attempts < 8 ? "retry" as const : "failed" as const;
  }
  // A persistence failure after acceptance must not be treated as a failed POST.
  await markSent(delivery, providerMessageId);
  return "sent" as const;
}

export async function processOrderNotificationBatch(limit = 10) {
  if (!areOrderStatusNotificationsEnabled() || !getNotificationConfiguration().appOriginValid) {
    return { claimed: 0, failed: 0, retry: 0, sent: 0, skipped: 0, superseded: 0 };
  }
  const deliveries = await claimDueDeliveries(limit);
  const result = { claimed: deliveries.length, failed: 0, retry: 0, sent: 0, skipped: 0, superseded: 0 };
  for (const delivery of deliveries) {
    try {
      const status = await processDelivery(delivery);
      result[status] += 1;
      logOperationalEvent("order_notification.delivery", {
        delivery_id: delivery.id,
        event_type: delivery.event_type,
        provider: delivery.provider,
        status
      });
    } catch {
      result.failed += 1;
      logOperationalError("order_notification.persistence_failed", { delivery_id: delivery.id });
    }
  }
  return result;
}
