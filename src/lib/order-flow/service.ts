import "server-only";

import { createDatabaseServerClient } from "@/lib/database/server";
import { logOperationalEvent } from "@/lib/observability";
import { getPostgresSql } from "@/lib/postgres/server";
import type { OrderActorRole } from "./types";

type CartItemInput = {
  product_id: string;
  quantity: number;
  removed_ingredient_ids?: string[];
  extras?: Array<{ ingredient_id: string; quantity: number }>;
  modifier_option_ids?: string[];
  note?: string;
};

type WebOrderInput = {
  source: "web";
  customerId: string;
  deliveryType: "pickup" | "delivery";
  address: string | null;
  comment: string | null;
  items: CartItemInput[];
  idempotencyKey: string;
  personalDataGranted: boolean;
  offerAccepted: boolean;
  marketingGranted: boolean;
  documentVersion: string;
  sourcePath: string;
  userAgentShort: string | null;
  fulfillmentMode: "asap" | "scheduled";
  requestedAt: string | null;
  receiptEmail: string;
  requiresPayment: boolean;
};

type PosOrderInput = {
  source: "pos";
  locationId: string;
  customerId: string | null;
  customerName: string;
  comment: string | null;
  items: CartItemInput[];
  idempotencyKey: string;
  actorId: string | null;
  actorRole: OrderActorRole;
  fulfillmentMode?: "asap" | "scheduled";
  requestedAt?: string | null;
};

export type CreateOrderInput = WebOrderInput | PosOrderInput;

export type CreateOrderResult = {
  orderId: string;
  total: number;
  displayNumber: string | null;
  paymentId: string | null;
};

function firstRow(value: unknown) {
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : null;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");
  const isTest = process.env.TEST_ORDER_MODE === "true";

  if (input.source === "web") {
    const { data, error } = await database.rpc(
      input.requiresPayment ? "create_site_order_with_payment" : "create_site_order",
      {
        p_address: input.deliveryType === "delivery" ? input.address : null,
        p_comment: input.comment,
        p_customer_id: input.customerId,
        p_delivery_type: input.deliveryType,
        p_document_version: input.documentVersion,
        p_idempotency_key: input.idempotencyKey,
        p_items: input.items,
        p_fulfillment_mode: input.fulfillmentMode,
        p_requested_at: input.fulfillmentMode === "scheduled" ? input.requestedAt : null,
        p_marketing_granted: input.marketingGranted,
        p_offer_accepted: input.offerAccepted,
        p_personal_data_granted: input.personalDataGranted,
        p_source_path: input.sourcePath,
        p_user_agent_short: input.userAgentShort,
        ...(input.requiresPayment
          ? {
              p_receipt_email: input.receiptEmail,
              p_payment_idempotency_key: input.idempotencyKey
            }
          : { p_is_test: isTest })
      }
    );
    const order = firstRow(data);
    if (error || !order?.order_id) {
      const failure = new Error(error?.message || "Не удалось создать заказ.");
      Object.assign(failure, { code: error?.code });
      throw failure;
    }
    const result = {
      orderId: String(order.order_id),
      total: Number(order.total ?? 0),
      displayNumber: order.display_number ? String(order.display_number) : null,
      paymentId: order.payment_id ? String(order.payment_id) : null
    };
    logOperationalEvent("order.created", {
      order_id: result.orderId,
      source: "web",
      item_lines: input.items.length,
      is_test: isTest
    });
    return result;
  }

  const { data, error } = await database.rpc("create_pos_order_atomic", {
    p_location_id: input.locationId,
    p_customer_name: input.customerName,
    p_comment: input.comment,
    p_items: input.items,
    p_idempotency_key: input.idempotencyKey,
    p_actor_id: input.actorId,
    p_actor_role: input.actorRole,
    p_fulfillment_mode: input.fulfillmentMode ?? "asap",
    p_requested_at: input.fulfillmentMode === "scheduled" ? input.requestedAt ?? null : null,
    p_is_test: isTest,
    p_customer_id: input.customerId
  });
  const order = firstRow(data);
  if (error || !order?.order_id) {
    const failure = new Error(error?.message || "Не удалось создать заказ на кассе.");
    Object.assign(failure, { code: error?.code });
    throw failure;
  }
  const result = {
    orderId: String(order.order_id),
    total: Number(order.total ?? 0),
    displayNumber: order.display_number ? String(order.display_number) : null,
    paymentId: null
  };
  logOperationalEvent("order.created", {
    order_id: result.orderId,
    source: "pos",
    location_id: input.locationId,
    item_lines: input.items.length,
    is_test: isTest
  });
  return result;
}

export async function transitionOrder(params: {
  orderId: string;
  status: string;
  actorId: string | null;
  actorRole: OrderActorRole;
  deviceSource: string;
  station?: "snacks" | "main";
}) {
  const data = await getPostgresSql().begin(async (sql) => {
    const [order] = await sql<{ kitchen_status: string; is_test: boolean; source: string; payment_status: string }[]>`
      select kitchen_status, is_test, source, payment_status
      from public.orders where id = ${params.orderId}::uuid for update
    `;
    const fail = (message: string): never => { throw Object.assign(new Error(message), { code: "P0001" }); };
    if (!order || order.is_test !== (process.env.TEST_ORDER_MODE === "true")) {
      fail("Этот заказ недоступен в текущем окружении.");
    }
    if (params.status === "handed_out" && !order.is_test && ["pos", "kiosk"].includes(order.source)
      && !["paid", "partially_refunded"].includes(order.payment_status)) {
      fail("Оплата не подтверждена. Сначала оплатите заказ на кассе.");
    }
    if (params.station) {
      const [row] = await sql<{ result: { ok?: boolean; warnings?: string[]; already_applied?: boolean } }[]>`
        select public.set_order_kitchen_station_status_atomic(
          ${params.orderId}::uuid, ${params.station}::text, ${params.status}::text,
          ${params.actorId}::uuid, ${params.actorRole}::text, ${params.deviceSource}::text
        ) as result
      `;
      return row.result;
    }
    const apply = async (status: string) => {
      const [row] = await sql<{ result: { ok?: boolean; warnings?: string[]; already_applied?: boolean } }[]>`
        select public.set_order_kitchen_status_atomic(
          ${params.orderId}::uuid, ${status}::text, ${params.actorId}::uuid,
          ${params.actorRole}::text, ${params.deviceSource}::text
        ) as result
      `;
      return row.result;
    };
    // Preserve existing SQL permissions/events, but commit acceptance and cooking together.
    if (params.status === "cooking" && order.kitchen_status === "new") await apply("accepted");
    return apply(params.status);
  });
  logOperationalEvent("order.status_transition", {
    order_id: params.orderId,
    to_status: params.status,
    actor_role: params.actorRole,
    device_source: params.deviceSource,
    station: params.station ?? null
  });
  return (data ?? {}) as { ok?: boolean; warnings?: string[]; already_applied?: boolean };
}
