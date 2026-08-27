import "server-only";

import { createDatabaseServerClient } from "@/lib/database/server";
import { logOperationalEvent } from "@/lib/observability";
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
    p_is_test: isTest
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
}) {
  const database = createDatabaseServerClient();
  if (!database) throw new Error("База данных не подключена.");
  const { data, error } = await database.rpc("set_order_kitchen_status_atomic", {
    p_order_id: params.orderId,
    p_status: params.status,
    p_actor_id: params.actorId,
    p_actor_role: params.actorRole,
    p_device_source: params.deviceSource
  });
  if (error) {
    const failure = new Error(error.message || "Не удалось изменить статус заказа.");
    Object.assign(failure, { code: error.code });
    throw failure;
  }
  logOperationalEvent("order.status_transition", {
    order_id: params.orderId,
    to_status: params.status,
    actor_role: params.actorRole,
    device_source: params.deviceSource
  });
  return (data ?? {}) as { ok?: boolean; warnings?: string[]; already_applied?: boolean };
}
