import "server-only";

import type { getPostgresSql } from "@/lib/postgres/server";
import { getOrderNotificationPolicy } from "./policy";

// All queue mutations and manual retry predicates use the same delivery alias.
// Old rows remain intact, including their unique key, until an audited exclusion.
export function orderNotificationScope(sql: ReturnType<typeof getPostgresSql>) {
  const telegram = getOrderNotificationPolicy("telegram");
  const max = getOrderNotificationPolicy("max");
  return sql`
    (
      (${telegram.enabled && Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())}
        and delivery.provider = 'telegram'
        and delivery.created_at >= ${telegram.notBefore}::timestamptz
        and (${!telegram.canary} or delivery.order_id = ${telegram.canaryOrderId}::uuid)
        and exists (select 1 from public.orders scope_order
          where scope_order.id = delivery.order_id and scope_order.created_at >= ${telegram.notBefore}::timestamptz))
      or (${max.enabled && Boolean(process.env.MAX_BOT_TOKEN?.trim())}
        and delivery.provider = 'max'
        and delivery.created_at >= ${max.notBefore}::timestamptz
        and exists (select 1 from public.orders scope_order
          where scope_order.id = delivery.order_id and scope_order.created_at >= ${max.notBefore}::timestamptz))
    )
  `;
}
