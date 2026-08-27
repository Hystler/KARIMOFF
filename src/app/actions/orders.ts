"use server";

import { randomUUID } from "node:crypto";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getShortUserAgent, isChecked } from "@/lib/legal-consents";
import { LEGAL_VERSION } from "@/lib/legal";
import { createOrderSchema, initialOrderActionState, type OrderActionState } from "@/lib/order-schema";
import { createOrder } from "@/lib/order-flow/service";
import { isYooKassaCheckoutEnabled } from "@/lib/payments/yookassa/config";
import { safeYooKassaErrorCode } from "@/lib/payments/yookassa/errors";
import { createYooKassaPaymentForOrder } from "@/lib/payments/yookassa/service";
import { validateSameDayMoscowRequestedAt } from "@/lib/order-time";
import { getSiteSettings } from "@/lib/settings";

export async function getCurrentCustomerAction() {
  return getCurrentCustomer();
}

export async function getCheckoutContextAction() {
  const [customer, settings] = await Promise.all([getCurrentCustomer(), getSiteSettings()]);
  let receiptEmail = "";
  if (customer) {
    const database = createDatabaseServerClient();
    const [{ data: profile }, { data: identities }] = database
      ? await Promise.all([
          database
            .from("customers")
            .select("receipt_email")
            .eq("id", customer.id)
            .maybeSingle(),
          database
            .from("user_identities")
            .select("email, last_login_at")
            .eq("user_id", customer.id)
            .order("last_login_at", { ascending: false })
            .limit(10)
        ])
      : [{ data: null }, { data: null }];
    const identity = (identities ?? []).find((row) =>
      typeof row.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)
    );
    receiptEmail = typeof profile?.receipt_email === "string"
      ? profile.receipt_email
      : identity?.email
        ? String(identity.email)
        : "";
  }

  return {
    customer,
    payment: {
      enabled: isYooKassaCheckoutEnabled(),
      receiptEmail
    },
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

  if (process.env.MAINTENANCE_MODE === "true") {
    return {
      status: "error",
      message: "Сервис временно обновляется. Попробуйте снова через несколько минут."
    };
  }

  const customer = await getCurrentCustomer();

  if (!customer) {
    return {
      status: "error",
      message: "Чтобы оформить заказ, войдите или зарегистрируйтесь."
    };
  }

  if (!isYooKassaCheckoutEnabled()) {
    return {
      status: "error",
      message: "Онлайн-оплата временно недоступна. Попробуйте немного позже."
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
    receipt_email: String(formData.get("receipt_email") || ""),
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
    const validation = validateSameDayMoscowRequestedAt(parsed.data.requested_at || "");
    if (!validation.ok) return { status: "error", message: validation.message };
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

  const rawIdempotencyKey = String(formData.get("idempotency_key") || "");
  const idempotencyKey = /^[0-9a-f-]{36}$/i.test(rawIdempotencyKey)
    ? rawIdempotencyKey
    : randomUUID();
  try {
    const order = await createOrder({
      source: "web",
      address: parsed.data.delivery_type === "delivery" ? parsed.data.address || null : null,
      comment: parsed.data.comment || null,
      customerId: customer.id,
      deliveryType: parsed.data.delivery_type,
      documentVersion: LEGAL_VERSION,
      idempotencyKey,
      items: parsed.data.cart,
      fulfillmentMode: parsed.data.fulfillment_mode,
      requestedAt:
        parsed.data.fulfillment_mode === "scheduled" ? parsed.data.requested_at || null : null,
      receiptEmail: parsed.data.receipt_email,
      requiresPayment: true,
      marketingGranted: isChecked(formData.get("marketing_consent")),
      offerAccepted: true,
      personalDataGranted: true,
      sourcePath: "/checkout",
      userAgentShort: await getShortUserAgent()
    });

    if (!order.paymentId) throw new Error("YOOKASSA_PAYMENT_ATTEMPT_MISSING");
    const payment = await createYooKassaPaymentForOrder(order.paymentId);

    return {
      status: "success",
      message: "Переходим к безопасной оплате в ЮKassa.",
      orderId: order.orderId,
      paymentConfirmationUrl: payment.confirmationUrl,
      paymentId: order.paymentId
    };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const providerCode = safeYooKassaErrorCode(error);
    return {
      status: "error",
      message: failure.code === "P0001"
        ? failure.message || "Проверьте заказ."
        : providerCode.startsWith("YOOKASSA_") || providerCode === "PAYMENTS_DISABLED"
          ? "Не удалось открыть оплату. Повторите попытку: новый заказ и второй платёж не создадутся."
          : "Не удалось создать заказ."
    };
  }
}
