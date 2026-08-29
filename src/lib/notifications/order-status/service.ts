import "server-only";

import { logOperationalEvent } from "@/lib/observability";
import { getPostgresSql } from "@/lib/postgres/server";
import {
  NotificationProviderError,
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
  return process.env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true";
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

  return sql<ClaimedDelivery[]>`
    with due as (
      select delivery.id
      from public.order_notification_deliveries delivery
      where (
          delivery.status in ('pending', 'retry')
          or (delivery.status = 'processing' and delivery.locked_at < now() - interval '5 minutes')
        )
        and delivery.available_at <= now()
        and (
          (${telegramConfigured} and delivery.provider = 'telegram')
          or (${maxConfigured} and delivery.provider = 'max')
        )
      order by delivery.available_at, delivery.created_at
      for update skip locked
      limit ${Math.max(1, Math.min(25, limit))}
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

async function markSuperseded(id: string) {
  const sql = getPostgresSql();
  await sql`
    update public.order_notification_deliveries
    set status = 'superseded', locked_at = null, updated_at = now()
    where id = ${id}::uuid
  `;
}

async function markSent(id: string, providerMessageId: string) {
  const sql = getPostgresSql();
  await sql`
    update public.order_notification_deliveries
    set status = 'sent', sent_at = now(), provider_message_id = ${providerMessageId || null},
        last_error_code = null, locked_at = null, updated_at = now()
    where id = ${id}::uuid
  `;
}

async function markFailed(delivery: ClaimedDelivery, error: NotificationProviderError) {
  const sql = getPostgresSql();
  const exhausted = delivery.attempts >= 8;
  const permanent = !error.retryable || exhausted;
  const retrySeconds = Math.ceil((error.retryAfterMs ?? getOrderNotificationRetryDelay(delivery.attempts) * 1_000) / 1_000);
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
    where id = ${delivery.id}::uuid
  `;
}

async function processDelivery(delivery: ClaimedDelivery) {
  const sql = getPostgresSql();
  const [order] = await sql<{
    display_number: string;
    kitchen_status: string;
  }[]>`
    select order_row.display_number, order_row.kitchen_status
    from public.orders order_row
    join public.order_notification_deliveries delivery
      on delivery.order_id = order_row.id
    join public.user_identities identity_row
      on identity_row.id = delivery.identity_id
     and identity_row.provider = delivery.provider
     and identity_row.provider_user_id = delivery.provider_user_id
    where delivery.id = ${delivery.id}::uuid
      and order_row.is_test = false
  `;
  const stillRelevant = delivery.event_type === "ready"
    ? order?.kitchen_status === "ready"
    : order?.kitchen_status === "cancelled";
  if (!order || !stillRelevant) {
    await markSuperseded(delivery.id);
    return "superseded" as const;
  }

  try {
    const providerMessageId = await sendOrderStatusNotification({
      event: delivery.event_type,
      orderNumber: order.display_number,
      provider: delivery.provider,
      recipientId: delivery.provider_user_id
    });
    await markSent(delivery.id, providerMessageId);
    return "sent" as const;
  } catch (error) {
    const safeError = error instanceof NotificationProviderError
      ? error
      : new NotificationProviderError(`${delivery.provider}_unknown_failure`, true);
    await markFailed(delivery, safeError);
    return safeError.retryable && delivery.attempts < 8 ? "retry" as const : "failed" as const;
  }
}

export async function processOrderNotificationBatch(limit = 10) {
  if (!areOrderStatusNotificationsEnabled()) {
    return { claimed: 0, failed: 0, retry: 0, sent: 0, superseded: 0 };
  }
  const deliveries = await claimDueDeliveries(limit);
  const result = { claimed: deliveries.length, failed: 0, retry: 0, sent: 0, superseded: 0 };
  for (const delivery of deliveries) {
    const status = await processDelivery(delivery);
    result[status] += 1;
    logOperationalEvent("order_notification.delivery", {
      delivery_id: delivery.id,
      event_type: delivery.event_type,
      provider: delivery.provider,
      status
    });
  }
  return result;
}
