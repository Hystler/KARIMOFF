import "server-only";

import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { logOperationalError } from "@/lib/observability";
import { getPostgresSql } from "@/lib/postgres/server";
import { getNotificationConfiguration } from "./order-status/configuration";

export const notificationStatuses = ["pending", "processing", "retry", "sent", "permanent_failure", "superseded"] as const;
export type NotificationStatus = typeof notificationStatuses[number];

export const notificationStatusLabels: Record<NotificationStatus, string> = {
  pending: "В очереди",
  processing: "В обработке",
  retry: "Ожидает повтора",
  sent: "Принято провайдером",
  permanent_failure: "Остановлено",
  superseded: "Неактуально"
};

export async function requireNotificationStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  // Global provider configuration and totals are deliberately not exposed to scoped managers.
  if (staff.role !== "owner" && staff.role !== "admin") redirect("/admin");
  return staff;
}

function safeRetryPredicate(sql: ReturnType<typeof getPostgresSql>) {
  const config = getNotificationConfiguration();
  return sql`
    ${config.enabled && !config.maintenance && config.appOriginValid}
    and delivery.status = 'permanent_failure' and delivery.attempts = 1
    and delivery.sent_at is null and delivery.provider_message_id is null
    and delivery.locked_at is null and delivery.available_at <= now()
    and delivery.last_error_code in (
      'app_origin_not_configured', 'telegram_not_configured', 'max_not_configured',
      'telegram_recipient_unverified'
    )
    and ((${config.telegramConfigured} and delivery.provider = 'telegram')
      or (${config.maxConfigured} and delivery.provider = 'max'))
    and exists (
      select 1 from public.orders order_row
      join public.user_identities identity_row on identity_row.id = delivery.identity_id
        and identity_row.provider = delivery.provider
        and identity_row.provider_user_id = delivery.provider_user_id
        and identity_row.user_id = delivery.customer_id
        and identity_row.user_id = order_row.customer_id
      where order_row.id = delivery.order_id and order_row.is_test = false
        and order_row.kitchen_status = delivery.event_type
        and (delivery.provider <> 'telegram' or case
          when coalesce(identity_row.metadata->>'telegramBotUserId', '') ~ '^[1-9][0-9]{0,15}$'
          then (identity_row.metadata->>'telegramBotUserId')::numeric <= 9007199254740991
          else false end)
    )
  `;
}

type NotificationCount = {
  provider: "telegram" | "max";
  status: NotificationStatus;
  count: number;
  overdue: number;
  stale: number;
  older_than_day: number;
  last_sent_at: string | null;
};

type NotificationDelivery = {
  id: string;
  provider: "telegram" | "max";
  event_type: "ready" | "cancelled";
  status: NotificationStatus;
  attempts: number;
  available_at: string;
  updated_at: string;
  last_error_code: string | null;
  can_retry: boolean;
};

export function notificationErrorLabel(code: string | null) {
  if (!code) return null;
  if (["app_origin_not_configured", "telegram_not_configured", "max_not_configured"].includes(code)) return "Нет корректной конфигурации";
  if (["delivery_outcome_unknown", "telegram_outcome_unknown", "max_outcome_unknown", "telegram_network_failure", "max_network_failure", "telegram_unknown_failure", "max_unknown_failure"].includes(code)) return "Результат неизвестен; нужна проверка";
  if (["telegram_rate_limited", "max_rate_limited"].includes(code)) return "Лимит провайдера";
  if (["telegram_temporary_failure", "max_temporary_failure"].includes(code)) return "Временный отказ провайдера";
  if (["telegram_delivery_rejected", "max_delivery_rejected"].includes(code)) return "Отказ провайдера";
  if (code === "attempts_exhausted") return "Попытки исчерпаны";
  if (code === "delivery_disabled") return "Отправка выключена";
  if (code === "telegram_recipient_unverified") return "Адресат Telegram не подтверждён для Bot API";
  return "Требуется проверка";
}

export async function getNotificationWorkspace(attentionOnly = false) {
  await requireNotificationStaff();
  const configuration = getNotificationConfiguration();
  try {
    const sql = getPostgresSql();
    const counts = await sql<NotificationCount[]>`
      select provider, status, count(*)::int as count,
        count(*) filter (where status in ('pending', 'retry') and available_at <= now())::int as overdue,
        count(*) filter (where status = 'processing'
          and (locked_at is null or locked_at < now() - interval '5 minutes'))::int as stale,
        count(*) filter (where status in ('pending', 'retry')
          and created_at < now() - interval '1 day')::int as older_than_day,
        max(sent_at)::text as last_sent_at
      from public.order_notification_deliveries
      group by provider, status
    `;
    const deliveries = await sql<NotificationDelivery[]>`
      select delivery.id, delivery.provider, delivery.event_type, delivery.status,
        delivery.attempts, delivery.available_at::text, delivery.updated_at::text,
        delivery.last_error_code, (${safeRetryPredicate(sql)}) as can_retry
      from public.order_notification_deliveries delivery
      where (${!attentionOnly} or delivery.status in ('retry', 'processing', 'permanent_failure'))
      order by delivery.updated_at desc, delivery.id desc
      limit 50
    `;
    return {
      configuration, counts,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id, provider: delivery.provider, event_type: delivery.event_type,
        status: delivery.status, attempts: delivery.attempts, available_at: delivery.available_at,
        updated_at: delivery.updated_at, can_retry: delivery.can_retry,
        errorLabel: notificationErrorLabel(delivery.last_error_code)
      })),
      error: null, checkedAt: new Date().toISOString()
    };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const reason = code === "42P01" || code === "42703" ? "schema_missing" : "unavailable";
    logOperationalError("order_notification.health_unavailable", { code: reason });
    return { configuration, counts: [], deliveries: [], error: reason, checkedAt: null };
  }
}

export async function retryNotificationDelivery(id: string, confirmed: boolean) {
  const staff = await requireNotificationStaff();
  if (!confirmed || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return false;
  const configuration = getNotificationConfiguration();
  if (!configuration.enabled || configuration.maintenance || !configuration.appOriginValid) return false;
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      update public.order_notification_deliveries delivery
      set status = 'retry', available_at = now(), last_error_code = null, updated_at = now()
      where delivery.id = ${id}::uuid and (${safeRetryPredicate(sql)})
      returning delivery.id
    `;
    if (!rows.length) return false;
    await transaction`
      insert into public.audit_logs (
        actor_type, actor_id, action, entity_type, entity_id, metadata, source_path
      ) values (
        ${staff.legacy ? "admin" : "staff"}, ${staff.id}::uuid,
        'order_notification.retry', 'order_notification_delivery', ${id},
        '{"reason":"first_attempt_preflight_failure"}'::jsonb, '/admin/notifications'
      )
    `;
    return true;
  });
}
