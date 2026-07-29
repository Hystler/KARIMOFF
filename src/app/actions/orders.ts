"use server";

import { randomUUID } from "node:crypto";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getShortUserAgent, isChecked } from "@/lib/legal-consents";
import { LEGAL_VERSION } from "@/lib/legal";
import { createOrderSchema, initialOrderActionState, type OrderActionState } from "@/lib/order-schema";
import { getSiteSettings } from "@/lib/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentCustomerAction() {
  return getCurrentCustomer();
}

export async function getCheckoutContextAction() {
  const [customer, settings] = await Promise.all([getCurrentCustomer(), getSiteSettings()]);

  return {
    customer,
    settings: {
      delivery_enabled: settings.delivery_enabled,
      pickup_enabled: settings.pickup_enabled
    }
  };
}

export async function createOrderAction(
  _previousState: OrderActionState = initialOrderActionState,
  formData: FormData
): Promise<OrderActionState> {
  void _previousState;

  const customer = await getCurrentCustomer();

  if (!customer) {
    return {
      status: "error",
      message: "Чтобы оформить заказ, войдите или зарегистрируйтесь."
    };
  }

  let parsedCart: unknown;

  try {
    parsedCart = JSON.parse(String(formData.get("cart") || "[]"));
  } catch {
    return {
      status: "error",
      message: "Не удалось прочитать корзину."
    };
  }

  const parsed = createOrderSchema.safeParse({
    delivery_type: formData.get("delivery_type"),
    fulfillment_mode: formData.get("fulfillment_mode"),
    requested_at: String(formData.get("requested_at") || ""),
    address: String(formData.get("address") || ""),
    comment: String(formData.get("comment") || ""),
    cart: parsedCart
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Проверьте заказ."
    };
  }

  if (!isChecked(formData.get("personal_data_consent"))) {
    return {
      status: "error",
      message: "Нужно дать согласие на обработку персональных данных."
    };
  }

  if (!isChecked(formData.get("offer_acceptance"))) {
    return {
      status: "error",
      message: "Нужно принять условия публичной оферты."
    };
  }

  if (parsed.data.delivery_type === "delivery" && !parsed.data.address) {
    return {
      status: "error",
      message: "Укажите адрес доставки."
    };
  }

  if (parsed.data.fulfillment_mode === "scheduled") {
    const requestedAt = parsed.data.requested_at ? new Date(parsed.data.requested_at) : null;
    const minimum = Date.now() + 15 * 60 * 1000;
    const maximum = Date.now() + 7 * 24 * 60 * 60 * 1000;

    if (!requestedAt || Number.isNaN(requestedAt.getTime())) {
      return { status: "error", message: "Выберите время получения заказа." };
    }

    if (requestedAt.getTime() < minimum || requestedAt.getTime() > maximum) {
      return {
        status: "error",
        message: "Выберите время не раньше чем через 15 минут и не позже чем через 7 дней."
      };
    }
  }

  const settings = await getSiteSettings();

  if (parsed.data.delivery_type === "delivery" && !settings.delivery_enabled) {
    return {
      status: "error",
      message: "Доставка временно недоступна."
    };
  }

  if (parsed.data.delivery_type === "pickup" && !settings.pickup_enabled) {
    return {
      status: "error",
      message: "Самовывоз временно недоступен."
    };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      status: "error",
      message: "Supabase не подключён."
    };
  }

  const rawIdempotencyKey = String(formData.get("idempotency_key") || "");
  const idempotencyKey = /^[0-9a-f-]{36}$/i.test(rawIdempotencyKey)
    ? rawIdempotencyKey
    : randomUUID();
  const { data, error } = await supabase.rpc("create_site_order", {
    p_address: parsed.data.delivery_type === "delivery" ? parsed.data.address || null : null,
    p_comment: parsed.data.comment || null,
    p_customer_id: customer.id,
    p_delivery_type: parsed.data.delivery_type,
    p_document_version: LEGAL_VERSION,
    p_idempotency_key: idempotencyKey,
    p_items: parsed.data.cart,
    p_fulfillment_mode: parsed.data.fulfillment_mode,
    p_requested_at:
      parsed.data.fulfillment_mode === "scheduled" ? parsed.data.requested_at || null : null,
    p_marketing_granted: isChecked(formData.get("marketing_consent")),
    p_offer_accepted: true,
    p_personal_data_granted: true,
    p_source_path: "/checkout",
    p_user_agent_short: await getShortUserAgent()
  });

  const order = Array.isArray(data) ? data[0] : null;

  if (error || !order?.order_id) {
    return {
      status: "error",
      message: error?.code === "P0001" ? error.message : "Не удалось создать заказ."
    };
  }

  return {
    status: "success",
    message: "Заказ отправлен. Мы свяжемся с вами для подтверждения.",
    orderId: String(order.order_id)
  };
}
