"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { canStaffAccessOrder } from "@/lib/order-flow/access";
import { canCancelOrder, canTransitionKitchen } from "@/lib/order-flow/permissions";
import { transitionOrder } from "@/lib/order-flow/service";
import { KITCHEN_STATUSES, type KitchenStatus } from "@/lib/order-flow/types";
import { getPostgresSql } from "@/lib/postgres/server";
import { getYooKassaPaymentContext } from "@/lib/payments/yookassa/repository";
import { checkYooKassaPaymentStatusReadOnly, createYooKassaRefund } from "@/lib/payments/yookassa/service";

const allowedStatuses = new Set<string>(KITCHEN_STATUSES);

async function requireStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}

function getOrderId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/orders?error=missing_id");
  }

  return id;
}

export async function updateOrderStatusAction(formData: FormData) {
  const staff = await requireStaff();

  const id = getOrderId(formData);
  const status = String(formData.get("status") || "") as KitchenStatus;
  const fromStatus = String(formData.get("from_status") || "") as KitchenStatus;
  const returnTo = formData.get("return_to") === "/admin/kitchen" ? "/admin/kitchen" : "/admin/orders";

  if (!allowedStatuses.has(status)) {
    redirect("/admin/orders?error=bad_status");
  }
  if (status === "cancelled" && fromStatus === "handed_to_courier") {
    redirect(`${returnTo}?error=${encodeURIComponent("После передачи курьеру заказ нельзя отменить из кухни.")}`);
  }

  if (!await canStaffAccessOrder(staff, id)) {
    redirect(`${returnTo}?error=${encodeURIComponent("Заказ относится к недоступной точке.")}`);
  }

  if (status === "cancelled") {
    const sql = getPostgresSql();
    const [order] = await sql<{
      delivery_type: string;
      payment_status: string;
    }[]>`
      select delivery_type, payment_status
      from public.orders
      where id = ${id}::uuid
    `;
    if (order?.delivery_type === "delivery" && ["paid", "partially_refunded", "refunded"].includes(order.payment_status)) {
      redirect(`${returnTo}?error=${encodeURIComponent("Оплаченный заказ доставки можно отменить только после полного возврата через ЮKassa.")}`);
    }
  }

  if (status === "cancelled" ? !canCancelOrder(staff.role) : !canTransitionKitchen(staff.role, fromStatus, status)) {
    redirect(`${returnTo}?error=${encodeURIComponent("Этот переход недоступен для вашей роли.")}`);
  }
  let inventoryWarning: string | null = null;
  try {
    const result = await transitionOrder({
      orderId: id,
      status,
      actorId: staff.id,
      actorRole: staff.role,
      deviceSource: "admin-orders"
    });
    inventoryWarning = result.warnings?.filter(Boolean).join(" ") || null;
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const message = failure.code === "P0001" ? failure.message : "Не удалось изменить статус заказа.";
    redirect(`${returnTo}?error=${encodeURIComponent(message || "Не удалось изменить статус заказа.")}`);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/kitchen");
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/economics");
  redirect(`${returnTo}?saved=1${inventoryWarning ? `&warning=${encodeURIComponent(inventoryWarning)}` : ""}`);
}

export async function cancelAndRefundDeliveryAction(formData: FormData) {
  const staff = await requireStaff();
  const id = getOrderId(formData);
  if (staff.legacy || !["owner", "admin"].includes(staff.role)) {
    redirect(`/admin/orders?error=${encodeURIComponent("Полный возврат и отмену доставки может выполнить владелец или администратор.")}`);
  }
  if (!await canStaffAccessOrder(staff, id)) {
    redirect(`/admin/orders?error=${encodeURIComponent("Заказ относится к недоступной точке.")}`);
  }
  if (!staff.id) {
    redirect(`/admin/orders?error=${encodeURIComponent("Не удалось определить сотрудника для аудита возврата.")}`);
  }

  const sql = getPostgresSql();
  const [order] = await sql<{
    delivery_type: string;
    is_test: boolean;
    kitchen_status: string;
    payment_id: string | null;
    payment_amount: string | null;
    order_total: string;
    order_payment_status: string;
    payment_provider: string | null;
    payment_matches_order: boolean | null;
  }[]>`
    select
      order_row.delivery_type,
      order_row.is_test,
      order_row.kitchen_status,
      order_row.payment_status as order_payment_status,
      order_row.total::text as order_total,
      payment.id as payment_id,
      payment.amount::text as payment_amount,
      payment.provider as payment_provider,
      payment.amount = order_row.total as payment_matches_order
    from public.orders order_row
    left join lateral (
      select id, amount, provider
      from public.payments
      where order_id = order_row.id and provider = 'yookassa'
      order by created_at desc
      limit 1
    ) payment on true
    where order_row.id = ${id}::uuid
  `;
  if (!order || order.delivery_type !== "delivery" || order.is_test) {
    redirect(`/admin/orders?error=${encodeURIComponent("Не найден оплаченный рабочий заказ доставки.")}`);
  }
  if (!["new", "accepted", "cooking"].includes(order.kitchen_status)) {
    redirect(`/admin/orders?error=${encodeURIComponent("Отменить можно только доставку до её готовности. После готовности обратитесь к владельцу.")}`);
  }
  if (!order.payment_id || order.payment_provider !== "yookassa" || !order.payment_amount) {
    redirect(`/admin/orders?error=${encodeURIComponent("Для заказа не найден платёж YooKassa.")}`);
  }
  if (!["paid", "refunded"].includes(order.order_payment_status)) {
    redirect(`/admin/orders?error=${encodeURIComponent("Заказ ещё не оплачен полностью или по нему оформлен частичный возврат.")}`);
  }
  if (!order.payment_matches_order) {
    redirect(`/admin/orders?error=${encodeURIComponent("Сумма платежа не совпадает с заказом. Нужна ручная проверка.")}`);
  }

  let refundStatus: string;
  let refundId: string;
  try {
    const refund = await createYooKassaRefund({
      amount: order.payment_amount,
      createdByStaffId: staff.id,
      idempotencyKey: `delivery-cancel-${id.replaceAll("-", "")}`,
      paymentId: order.payment_id,
      reason: "Полная отмена заказа доставки"
    });
    refundStatus = refund.status;
    refundId = refund.refundId;
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const message = failure.code === "P0001" ? failure.message : "Не удалось подтвердить возврат в ЮKassa. Заказ не отменён.";
    redirect(`/admin/orders?error=${encodeURIComponent(message || "Не удалось отменить заказ доставки.")}`);
  }

  if (refundStatus !== "succeeded") {
    redirect(`/admin/orders?error=${encodeURIComponent("ЮKassa ещё обрабатывает полный возврат. Заказ пока оставлен активным; повторите отмену после подтверждения возврата.")}`);
  }
  try {
    await transitionOrder({
      orderId: id,
      status: "cancelled",
      actorId: staff.id,
      actorRole: staff.role,
      deviceSource: "admin-delivery-refund"
    });
    await writeAuditLog({
      action: "delivery.cancel_and_full_refund",
      actorId: staff.id,
      actorType: "staff",
      entityId: id,
      entityType: "order",
      metadata: { provider: "yookassa", refund_id: refundId },
      sourcePath: "/admin/orders"
    });
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const message = failure.code === "P0001" ? failure.message : "Возврат подтверждён, но заказ не отменён автоматически. Требуется ручная проверка.";
    redirect(`/admin/orders?error=${encodeURIComponent(message || "Возврат завершён; проверьте статус заказа.")}`);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/kitchen");
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/economics");
  redirect("/admin/orders?saved=1");
}

export async function checkYooKassaPaymentStatusAction(formData: FormData) {
  const staff = await requireStaff();
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) {
    redirect("/admin/orders?error=payment_permission");
  }
  const orderId = String(formData.get("order_id") || "");
  const paymentId = String(formData.get("payment_id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
    redirect("/admin/orders?error=payment_not_found");
  }
  if (!await canStaffAccessOrder(staff, orderId)) {
    redirect(`/admin/orders?error=${encodeURIComponent("Заказ относится к недоступной точке.")}`);
  }
  const payment = await getYooKassaPaymentContext(paymentId);
  if (!payment || payment.orderId !== orderId) {
    redirect("/admin/orders?error=payment_not_found");
  }

  try {
    await checkYooKassaPaymentStatusReadOnly(paymentId);
    await writeAuditLog({
      action: "payment.status_check",
      actorId: staff.id,
      actorType: staff.legacy ? "admin" : "staff",
      entityId: paymentId,
      entityType: "payment",
      metadata: { order_id: orderId, provider: "yookassa" },
      sourcePath: "/admin/orders"
    });
  } catch {
    redirect(`/admin/orders?error=${encodeURIComponent("Не удалось получить статус платежа в ЮKassa.")}`);
  }

  revalidatePath("/admin/orders");
  redirect("/admin/orders?payment_checked=1");
}
