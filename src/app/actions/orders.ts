"use server";

import { randomUUID } from "node:crypto";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getShortUserAgent, isChecked } from "@/lib/legal-consents";
import { LEGAL_VERSION } from "@/lib/legal";
import { createOrderSchema, initialOrderActionState, type OrderActionState } from "@/lib/order-schema";
import { createOrder, type DeliveryAddressSnapshot } from "@/lib/order-flow/service";
import { isYooKassaCheckoutEnabled } from "@/lib/payments/yookassa/config";
import { safeYooKassaErrorCode } from "@/lib/payments/yookassa/errors";
import { createYooKassaPaymentForOrder } from "@/lib/payments/yookassa/service";
import { validateSameDayMoscowRequestedAt } from "@/lib/order-time";
import { getSiteSettings } from "@/lib/settings";
import { assessDeliveryZone } from "@/lib/delivery/geo";
import { isDeliveryAcceptingAt } from "@/lib/delivery/hours";
import { getDeliveryLocationSettings } from "@/lib/delivery/settings";
import { geocodeDeliveryAddress, suggestDeliveryAddresses } from "@/lib/delivery/yandex";

const unavailableAddressMessage = "Не удалось проверить адрес. Попробуйте ещё раз.";

function cleanAddressPart(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function addressSearchText(street: string, house: string) {
  return `${street} ${house}, Щёлково, Московская область, Россия`;
}

function normalizeAddressPart(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
}

async function resolveDeliveryAddress(street: string, house: string) {
  const config = await getDeliveryLocationSettings();
  if (!config || !config.enabled) throw new Error("DELIVERY_DISABLED");
  const geocoded = await geocodeDeliveryAddress(addressSearchText(street, house));
  const requestedStreet = normalizeAddressPart(street);
  const resolvedStreet = normalizeAddressPart(geocoded.street);
  if (!resolvedStreet.includes(requestedStreet) && !requestedStreet.includes(resolvedStreet)) {
    throw new Error("DELIVERY_ADDRESS_AMBIGUOUS");
  }
  if (normalizeAddressPart(geocoded.house) !== normalizeAddressPart(house)) {
    throw new Error("DELIVERY_ADDRESS_AMBIGUOUS");
  }
  const assessment = assessDeliveryZone({
    address: geocoded.coordinates,
    center: config.center,
    radiusMeters: config.radiusMeters,
    excludedAreas: config.excludedAreas
  });
  return { config, geocoded, assessment };
}

export async function getCurrentCustomerAction() {
  return getCurrentCustomer();
}

export async function getCheckoutContextAction() {
  const [customer, settings, deliveryConfig] = await Promise.all([
    getCurrentCustomer(), getSiteSettings(), getDeliveryLocationSettings()
  ]);
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
      delivery_enabled: settings.delivery_enabled && settings.delivery_coverage_enabled && Boolean(deliveryConfig?.enabled),
      pickup_enabled: settings.pickup_enabled,
      delivery_fee: deliveryConfig?.deliveryFee ?? 200,
      free_delivery_threshold: deliveryConfig?.freeThreshold ?? 2500,
      delivery_eta_minutes: deliveryConfig?.etaMinutes ?? 60,
      delivery_acceptance_start: deliveryConfig?.acceptanceStart ?? "11:00",
      delivery_acceptance_end: deliveryConfig?.acceptanceEnd ?? "20:30",
      delivery_timezone: deliveryConfig?.timezone ?? "Europe/Moscow"
    }
  };
}

export async function suggestDeliveryAddressesAction(query: string) {
  const customer = await getCurrentCustomer();
  if (!customer) return { suggestions: [], error: "Войдите, чтобы оформить заказ." };
  try {
    const config = await getDeliveryLocationSettings();
    if (!config || !config.enabled) return { suggestions: [], error: "Доставка временно недоступна." };
    const suggestions = await suggestDeliveryAddresses(cleanAddressPart(query, 160), config.center);
    return { suggestions, error: null };
  } catch {
    return { suggestions: [], error: unavailableAddressMessage };
  }
}

export async function validateDeliveryAddressAction(input: { street?: string; house?: string }) {
  const customer = await getCurrentCustomer();
  if (!customer) return { available: false, message: "Войдите, чтобы оформить заказ." };
  const street = cleanAddressPart(input.street, 160);
  const house = cleanAddressPart(input.house, 40);
  if (!street || !house) return { available: false, message: "Укажите улицу и дом." };

  try {
    const { assessment, config } = await resolveDeliveryAddress(street, house);
    if (!assessment.available) {
      return {
        available: false,
        distanceMeters: assessment.distanceMeters,
        message: "По этому адресу доставка пока недоступна. Вы можете выбрать самовывоз или указать другой адрес."
      };
    }
    return {
      available: true,
      distanceMeters: assessment.distanceMeters,
      etaMinutes: config.etaMinutes,
      message: "Доставим по этому адресу. Стоимость доставки зависит от суммы товаров в корзине."
    };
  } catch {
    return { available: false, message: unavailableAddressMessage };
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
    address: String(formData.get("address") || ""),
    delivery_street: String(formData.get("delivery_street") || ""),
    delivery_house: String(formData.get("delivery_house") || ""),
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

  if (parsed.data.delivery_type === "delivery" && !settings.delivery_coverage_enabled) {
    return {
      status: "error",
      message: "Доставка пока не подключена: нужно настроить проверку адреса по границе зоны. Самовывоз доступен."
    };
  }

  let deliverySnapshot: DeliveryAddressSnapshot | null = null;
  let canonicalDeliveryAddress: string | null = null;
  if (parsed.data.delivery_type === "delivery") {
    try {
      const resolved = await resolveDeliveryAddress(parsed.data.delivery_street || "", parsed.data.delivery_house || "");
      if (!isDeliveryAcceptingAt(new Date(), resolved.config)) {
        return {
          status: "error",
          message: "Сегодня доставка уже закончилась. Вы можете выбрать самовывоз."
        };
      }
      if (!resolved.assessment.available) {
        return {
          status: "error",
          message: "По этому адресу доставка пока недоступна. Вы можете выбрать самовывоз или указать другой адрес."
        };
      }
      canonicalDeliveryAddress = resolved.geocoded.addressText;
      deliverySnapshot = {
        addressText: resolved.geocoded.addressText,
        street: resolved.geocoded.street,
        house: resolved.geocoded.house,
        apartment: parsed.data.delivery_apartment || null,
        entrance: parsed.data.delivery_entrance || null,
        floor: parsed.data.delivery_floor || null,
        intercom: parsed.data.delivery_intercom || null,
        courierComment: parsed.data.delivery_courier_comment || null,
        latitude: resolved.geocoded.coordinates[1],
        longitude: resolved.geocoded.coordinates[0],
        distanceMeters: resolved.assessment.distanceMeters,
        deliveryFee: resolved.config.deliveryFee,
        etaMinutes: resolved.config.etaMinutes,
        zoneValidation: "available",
        validatedAt: new Date().toISOString()
      };
    } catch {
      return { status: "error", message: unavailableAddressMessage };
    }
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
      address: canonicalDeliveryAddress,
      deliverySnapshot,
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
