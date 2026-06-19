"use server";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { createOrderSchema, initialOrderActionState, type OrderActionState } from "@/lib/order-schema";
import { getSiteSettings } from "@/lib/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
    address: formData.get("address"),
    comment: formData.get("comment"),
    cart: parsedCart
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Проверьте заказ."
    };
  }

  if (parsed.data.delivery_type === "delivery" && !parsed.data.address) {
    return {
      status: "error",
      message: "Укажите адрес доставки."
    };
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

  const total = parsed.data.cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  await ensureLoyaltyAccount(customer.id);
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      delivery_type: parsed.data.delivery_type,
      address: parsed.data.delivery_type === "delivery" ? parsed.data.address || null : null,
      comment: parsed.data.comment || null,
      status: "new",
      total,
      source: "site"
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return {
      status: "error",
      message: "Не удалось создать заказ."
    };
  }

  const orderId = String(order.id);
  const items = parsed.data.cart.map((line) => ({
    order_id: orderId,
    product_id: isUuid(line.product.id) ? line.product.id : null,
    product_name: line.product.name,
    unit_price: line.product.price,
    quantity: line.quantity,
    line_total: line.product.price * line.quantity
  }));

  const { error: itemsError } = await supabase.from("order_items").insert(items);

  if (itemsError) {
    await supabase.from("orders").delete().eq("id", orderId);
    return {
      status: "error",
      message: "Не удалось сохранить состав заказа."
    };
  }

  return {
    status: "success",
    message: "Заказ отправлен. Мы свяжемся с вами для подтверждения.",
    orderId
  };
}
