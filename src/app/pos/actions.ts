"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentStaff } from "@/lib/admin-auth";
import { createEvotorPosPayment } from "@/lib/integrations/evotor/pos-payments";
import { canStaffAccessOrderLocation } from "@/lib/order-flow/access";
import type { PosOrderActionState } from "@/lib/order-flow/pos-action-state";

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  removed_ingredient_ids: z.array(z.string().uuid()).max(50).default([]),
  extras: z.array(z.object({
    ingredient_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(20)
  })).max(30).default([]),
  modifier_option_ids: z.array(z.string().uuid()).max(20).default([]),
  note: z.string().trim().max(300).default("")
});

const payloadSchema = z.object({
  locationId: z.string().uuid(),
  customerName: z.string().trim().max(40).default("Гость"),
  customerId: z.union([z.string().uuid(), z.literal("")]).transform((value) => value || null),
  comment: z.string().trim().max(500).default(""),
  idempotencyKey: z.string().uuid(),
  items: z.array(itemSchema).min(1).max(50)
});

export async function createPosOrderAction(
  _previous: PosOrderActionState,
  formData: FormData
): Promise<PosOrderActionState> {
  if (process.env.MAINTENANCE_MODE === "true") {
    return { status: "error", message: "Сервис временно обновляется. Попробуйте снова через несколько минут." };
  }
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin", "manager", "cashier"].includes(staff.role)) {
    return { status: "error", message: "Сессия кассира завершена. Войдите снова." };
  }

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { status: "error", message: "Не удалось прочитать состав заказа." };
  }
  const parsed = payloadSchema.safeParse({
    locationId: formData.get("location_id"),
    customerName: formData.get("customer_name") || "Гость",
    customerId: formData.get("customer_id") || "",
    comment: formData.get("comment") || "",
    idempotencyKey: formData.get("idempotency_key") || randomUUID(),
    items
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message || "Проверьте заказ." };
  }
  if (!await canStaffAccessOrderLocation(staff, parsed.data.locationId)) {
    return { status: "error", message: "Эта точка недоступна для вашей учётной записи." };
  }

  try {
    const payment = await createEvotorPosPayment({
      locationId: parsed.data.locationId,
      customerId: parsed.data.customerId,
      customerName: parsed.data.customerName || "Гость",
      comment: parsed.data.comment || null,
      items: parsed.data.items,
      idempotencyKey: parsed.data.idempotencyKey,
      actorId: staff.id,
      actorRole: staff.role
    });
    return {
      status: "success",
      message: `Заказ ${payment.displayNumber || "создан"} отправлен на терминал. Ожидаем оплату.`,
      orderId: payment.orderId,
      displayNumber: payment.displayNumber || undefined,
      paymentIntentId: payment.intentId,
      paymentStatus: payment.status,
      amount: payment.amount
    };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return {
      status: "error",
      message: failure.code === "P0001" || failure.code === "EVOTOR_POS_PAYMENT"
        ? failure.message || "Проверьте заказ."
        : "Не удалось отправить заказ на терминал. Повторите попытку."
    };
  }
}
