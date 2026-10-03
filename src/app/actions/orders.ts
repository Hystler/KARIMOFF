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
import {
  findDeliveryAddressById,
  getDefaultDeliveryLocationId,
  hasAvailableDeliveryAddresses,
  isAvailableDeliveryAddress,
  listDeliveryHouses,
  searchDeliveryStreets,
  unavailableDeliveryAddressMessage
} from "@/lib/delivery/address-whitelist";

export async function getCurrentCustomerAction() {
  return getCurrentCustomer();
}

export async function getCheckoutContextAction() {
  const [customer, settings] = await Promise.all([getCurrentCustomer(), getSiteSettings()]);
  let whitelistReady = false;
  try {
    const locationId = await getDefaultDeliveryLocationId();
    whitelistReady = Boolean(locationId && await hasAvailableDeliveryAddresses(locationId));
  } catch {
    whitelistReady = false;
  }
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
      delivery_enabled: settings.delivery_enabled && whitelistReady,
      pickup_enabled: settings.pickup_enabled
    }
  };
}

export async function suggestDeliveryStreetsAction(query: string) {
  const customer = await getCurrentCustomer();
  if (!customer) return { streets: [], error: "Войдите, чтобы оформить заказ." };
  try {
    const locationId = await getDefaultDeliveryLocationId();
    if (!locationId) return { streets: [], error: unavailableDeliveryAddressMessage() };
    const streets = await searchDeliveryStreets(locationId, query);
    return { streets: streets.map((street) => street.street), error: null };
  } catch {
    return { streets: [], error: unavailableDeliveryAddressMessage() };
  }
}

export async function listDeliveryHousesAction(street: string) {
  const customer = await getCurrentCustomer();
  if (!customer) return { houses: [], error: "Войдите, чтобы оформить заказ." };
  try {
    const locationId = await getDefaultDeliveryLocationId();
    if (!locationId) return { houses: [], error: unavailableDeliveryAddressMessage() };
    const houses = await listDeliveryHouses(locationId, street);
    return { houses, error: null };
  } catch {
    return { houses: [], error: unavailableDeliveryAddressMessage() };
  }
}

export async function validateDeliveryAddressAction(input: { deliveryAddressId?: string }) {
  const customer = await getCurrentCustomer();
  if (!customer) return { available: false, message: "Войдите, чтобы оформить заказ." };
  const addressId = typeof input?.deliveryAddressId === "string" ? input.deliveryAddressId : "";
  try {
    const locationId = await getDefaultDeliveryLocationId();
    if (!locationId) return { available: false, message: unavailableDeliveryAddressMessage() };
    const address = await findDeliveryAddressById(addressId, locationId);
    const available = isAvailableDeliveryAddress(address, addressId, locationId);
    return {
      available,
      message: available ? "Доставка доступна." : unavailableDeliveryAddressMessage()
    };
  } catch {
    return { available: false, message: unavailableDeliveryAddressMessage() };
  }
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
    delivery_address_id: String(formData.get("delivery_address_id") || ""),
    delivery_apartment: String(formData.get("delivery_apartment") || ""),
    delivery_entrance: String(formData.get("delivery_entrance") || ""),
    delivery_floor: String(formData.get("delivery_floor") || ""),
    delivery_intercom: String(formData.get("delivery_intercom") || ""),
    delivery_courier_comment: String(formData.get("delivery_courier_comment") || ""),
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

  let deliveryAddressId: string | null = null;
  let deliveryDetails: {
    apartment: string;
    entrance: string;
    floor: string;
    intercom: string;
    courierComment: string;
  } | null = null;

  if (parsed.data.delivery_type === "delivery") {
    const locationId = await getDefaultDeliveryLocationId().catch(() => null);
    const address = locationId
      ? await findDeliveryAddressById(parsed.data.delivery_address_id, locationId).catch(() => null)
      : null;
    if (!locationId || !address
      || !isAvailableDeliveryAddress(address, parsed.data.delivery_address_id, locationId)) {
      return { status: "error", message: unavailableDeliveryAddressMessage() };
    }
    deliveryAddressId = address.id;
    deliveryDetails = {
      apartment: parsed.data.delivery_apartment,
      entrance: parsed.data.delivery_entrance,
      floor: parsed.data.delivery_floor,
      intercom: parsed.data.delivery_intercom,
      courierComment: parsed.data.delivery_courier_comment
    };
  }

  const rawIdempotencyKey = String(formData.get("idempotency_key") || "");
  const idempotencyKey = /^[0-9a-f-]{36}$/i.test(rawIdempotencyKey)
    ? rawIdempotencyKey
    : randomUUID();
  try {
    const order = await createOrder({
      source: "web",
      deliveryAddressId,
      deliveryDetails,
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
