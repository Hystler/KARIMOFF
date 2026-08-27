import { CalendarClock, CreditCard, MapPin, PackageCheck, Phone, ReceiptText, RefreshCw, ShoppingBag } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAdminOrders } from "@/lib/orders";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { canCancelOrder, canTransitionKitchen } from "@/lib/order-flow/permissions";
import { kitchenStatusLabel, orderSourceLabel, type KitchenStatus } from "@/lib/order-flow/types";
import { checkYooKassaPaymentStatusAction, updateOrderStatusAction } from "./actions";

const nextStatus: Partial<Record<KitchenStatus, KitchenStatus>> = {
  new: "accepted",
  accepted: "cooking",
  cooking: "ready",
  ready: "handed_out"
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoney(value: string) {
  const normalized = /^\d+(?:\.\d{1,2})?$/.test(value) ? value : "0";
  const [whole, fraction = ""] = normalized.split(".");
  const formatted = new Intl.NumberFormat("ru-RU").format(BigInt(whole));
  return fraction && fraction !== "00" ? `${formatted},${fraction.padEnd(2, "0")}` : formatted;
}

const paymentStatusLabels: Record<string, string> = {
  cancelled: "Отменено",
  completed: "Возвращено",
  failed: "Ошибка",
  paid: "Оплачено",
  partially_refunded: "Частично возвращено",
  pending: "Ожидает",
  refunded: "Возвращено"
};

const fiscalStatusLabels: Record<string, string> = {
  canceled: "Ошибка регистрации",
  cancelled: "Отменён",
  failed: "Ошибка",
  issued: "Зарегистрирован",
  pending: "Регистрируется",
  succeeded: "Зарегистрирован"
};

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams
}: {
  searchParams: Promise<{ deleted?: string; error?: string; payment_checked?: string; saved?: string; warning?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/kitchen");

  const params = await searchParams;
  const locations = await getAccessibleOrderLocations(staff);
  const locationIds = staff.legacy || ["owner", "admin"].includes(staff.role)
    ? null
    : locations.map((location) => location.id);
  const { orders, notConfigured, error } = await getAdminOrders(locationIds);

  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Продажи</p>
          <h1>Заказы</h1>
          <p>Время получения, пожелания гостя, оплата и путь заказа до кухни.</p>
        </div>
        <div className="admin-status">{orders.length} всего</div>
      </header>

      {params.saved ? <div className="admin-alert admin-alert-success">Статус заказа обновлён.</div> : null}
      {params.payment_checked ? <div className="admin-alert admin-alert-success">Статус платежа обновлён по данным ЮKassa.</div> : null}
      {params.deleted ? <div className="admin-alert admin-alert-success">Заказ удалён.</div> : null}
      {params.error || error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(params.error || error || "")}</div> : null}
      {params.warning ? <div className="admin-alert admin-alert-warning">{decodeURIComponent(params.warning)}</div> : null}

      {notConfigured ? (
        <div className="admin-empty">База данных не подключена.</div>
      ) : orders.length === 0 ? (
        <div className="admin-empty">Заказов пока нет.</div>
      ) : (
        <section className="grid gap-4">
          {orders.map((order) => (
            <article key={order.id} className="admin-order-card">
              <div className="admin-order-main">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-karimoff-orange">{order.display_number} · {orderSourceLabel(order.source)} · {formatDate(order.created_at)}</p>
                    {order.is_test ? <span className="mt-2 inline-block rounded-md bg-sky-100 px-2 py-1 text-[10px] font-black uppercase text-sky-800">Test · без склада и выручки</span> : null}
                    {!order.is_operational ? <span className="mt-2 inline-block rounded-md bg-black/5 px-2 py-1 text-[10px] font-black uppercase text-black/45">Архивный</span> : null}
                    <h2 className="mt-2 text-xl font-black">{order.customer_name}</h2>
                    {order.customer_phone ? (
                      <a href={`tel:${order.customer_phone}`} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-karimoff-muted">
                        <Phone size={15} /> {order.customer_phone}
                      </a>
                    ) : null}
                  </div>
                  <span className={`admin-order-status admin-order-status-${order.status}`}>{kitchenStatusLabel(order.kitchen_status)}</span>
                </div>

                <div className="mt-4 grid gap-2 rounded-lg bg-karimoff-cream p-4 text-sm sm:grid-cols-2">
                  <p className="flex items-center gap-2 font-bold">
                    <CalendarClock size={17} className="text-karimoff-orange" />
                    {order.fulfillment_mode === "scheduled" && order.requested_at
                      ? `К ${formatDate(order.requested_at)}`
                      : "Как можно скорее"}
                  </p>
                  <p className="flex items-center gap-2 text-karimoff-muted">
                    {order.delivery_type === "pickup" ? <PackageCheck size={17} /> : <MapPin size={17} />}
                    {order.delivery_type === "pickup" ? "Самовывоз" : order.address || "Доставка"}
                  </p>
                </div>

                {order.comment ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Комментарий: {order.comment}</p> : null}

                {order.payments.length ? (
                  <section className="mt-4 rounded-lg border border-karimoff-line bg-white p-4" aria-label="Оплата заказа">
                    <h3 className="flex items-center gap-2 text-sm font-black">
                      <CreditCard size={17} className="text-karimoff-orange" /> Оплата
                    </h3>
                    <div className="mt-3 grid gap-4">
                      {order.payments.map((payment) => (
                        <div key={payment.id} className="grid gap-2 border-t border-karimoff-line pt-3 first:border-0 first:pt-0 text-xs leading-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <strong>{payment.provider === "yookassa" ? "ЮKassa" : payment.provider}</strong>
                            <span className="rounded-md bg-karimoff-cream px-2 py-1 font-black">
                              {paymentStatusLabels[payment.status] ?? payment.status}
                            </span>
                          </div>
                          <p><span className="text-karimoff-muted">Сумма:</span> <strong>{formatMoney(payment.amount)} {payment.currency === "RUB" ? "₽" : payment.currency}</strong></p>
                          <p><span className="text-karimoff-muted">Создан:</span> {formatDate(payment.created_at)}</p>
                          {payment.paid_at ? <p><span className="text-karimoff-muted">Оплачен:</span> {formatDate(payment.paid_at)}</p> : null}
                          {payment.payment_method ? <p><span className="text-karimoff-muted">Способ:</span> {payment.payment_method}</p> : null}
                          {payment.provider_payment_id ? (
                            <p className="break-all"><span className="text-karimoff-muted">Payment ID:</span> <code>{payment.provider_payment_id}</code></p>
                          ) : null}
                          <p className="flex items-center gap-2">
                            <ReceiptText size={15} className="text-karimoff-orange" />
                            Фискализация: {fiscalStatusLabels[payment.receipt_registration ?? "pending"] ?? payment.receipt_registration ?? "ожидает"}
                          </p>
                          {payment.refunds.map((refund) => (
                            <p key={refund.id} className="rounded-md bg-rose-50 px-3 py-2 font-semibold text-rose-900">
                              Возврат {formatMoney(refund.amount)} ₽ · {paymentStatusLabels[refund.status] ?? refund.status}
                            </p>
                          ))}
                          {payment.fiscal_receipts.map((receipt) => (
                            <p key={receipt.id} className="text-karimoff-muted">
                              {receipt.receipt_phase === "prepayment_settlement" ? "Расчёт по предоплате" : receipt.receipt_phase === "refund" ? "Чек возврата" : "Чек предоплаты"}: {fiscalStatusLabels[receipt.status] ?? receipt.status}
                            </p>
                          ))}
                          {payment.provider === "yookassa" && (staff.legacy || ["owner", "admin", "manager"].includes(staff.role)) ? (
                            <form action={checkYooKassaPaymentStatusAction}>
                              <input type="hidden" name="order_id" value={order.id} />
                              <input type="hidden" name="payment_id" value={payment.id} />
                              <button type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-karimoff-line px-3 font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                                <RefreshCw size={15} /> Проверить статус
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>

              <div className="admin-order-items">
                <h3 className="flex items-center gap-2 text-sm font-black"><ShoppingBag size={17} /> Состав</h3>
                <div className="mt-3 grid gap-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="border-b border-karimoff-line pb-3 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <strong>{item.product_name} × {item.quantity}</strong>
                        <strong className="shrink-0 text-karimoff-orange">{formatPrice(item.line_total)} ₽</strong>
                      </div>
                      {item.modifiers.map((modifier) => (
                        <p key={modifier.id} className={`mt-1 text-xs font-black uppercase ${modifier.modifier_type === "remove" ? "text-amber-800" : modifier.modifier_type === "replace" ? "text-sky-800" : "text-emerald-800"}`}>
                          {modifier.modifier_type === "remove" ? "БЕЗ" : modifier.modifier_type === "replace" ? "ЗАМЕНА" : "+"} {modifier.ingredient_name}
                        </p>
                      ))}
                      {item.item_note ? <p className="mt-1 text-xs font-bold text-violet-800">К позиции: {item.item_note}</p> : null}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-between border-t border-karimoff-line pt-4 text-lg font-black">
                  <span>Итого</span><span className="text-karimoff-orange">{formatPrice(order.total)} ₽</span>
                </div>
              </div>

              <div className="admin-order-actions">
                {nextStatus[order.kitchen_status] && canTransitionKitchen(staff.role, order.kitchen_status, nextStatus[order.kitchen_status]!) ? (
                  <form action={updateOrderStatusAction} className="grid gap-2">
                    <input type="hidden" name="id" value={order.id} />
                    <input type="hidden" name="from_status" value={order.kitchen_status} />
                    <input type="hidden" name="status" value={nextStatus[order.kitchen_status]} />
                    <button type="submit" className="admin-primary-button">{kitchenStatusLabel(nextStatus[order.kitchen_status]!)}</button>
                  </form>
                ) : null}
                <p className="text-xs leading-5 text-karimoff-muted">
                  Исполнитель: {order.assigned_staff_name || "не назначен"}
                </p>
                {canCancelOrder(staff.role) && !["ready", "cancelled", "handed_out"].includes(order.kitchen_status) ? (
                  <form action={updateOrderStatusAction}>
                    <input type="hidden" name="id" value={order.id} />
                    <input type="hidden" name="from_status" value={order.kitchen_status} />
                    <input type="hidden" name="status" value="cancelled" />
                    <button type="submit" className="admin-danger-button w-full">Отменить заказ</button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
