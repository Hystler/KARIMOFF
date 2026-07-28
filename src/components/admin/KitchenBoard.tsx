"use client";

import { CheckCircle2, ChefHat, Clock3, MapPin, PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updateOrderStatusAction } from "@/app/admin/orders/actions";
import type { AdminOrder } from "@/lib/orders";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function OrderCard({ order }: { order: AdminOrder }) {
  const nextStatus = order.status === "new" ? "in_progress" : "completed";
  const actionLabel = order.status === "new" ? "Начать готовить" : "Готово";

  return (
    <article className={`kitchen-ticket ${order.status === "in_progress" ? "kitchen-ticket-active" : ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-karimoff-orange">Заказ {order.id.slice(0, 8)}</p>
          <h2 className="mt-1 text-xl font-black leading-tight">{order.customer_name}</h2>
        </div>
        <span className={order.status === "new" ? "kitchen-badge kitchen-badge-new" : "kitchen-badge"}>
          {order.status === "new" ? "Новый" : "Готовится"}
        </span>
      </header>

      <div className="mt-4 grid gap-2 rounded-lg bg-karimoff-cream p-3 text-sm">
        <p className="flex items-center gap-2 font-bold">
          <Clock3 size={17} className="text-karimoff-orange" />
          {order.fulfillment_mode === "scheduled" && order.requested_at
            ? `К ${timeLabel(order.requested_at)}`
            : "Как можно скорее"}
        </p>
        <p className="flex items-center gap-2 text-karimoff-muted">
          {order.delivery_type === "pickup" ? <PackageCheck size={17} /> : <MapPin size={17} />}
          {order.delivery_type === "pickup" ? "Самовывоз" : order.address || "Доставка"}
        </p>
      </div>

      <div className="mt-4 grid gap-4">
        {order.items.map((item) => (
          <section key={item.id} className="border-b border-karimoff-line pb-4 last:border-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-black leading-tight">{item.product_name}</h3>
              <strong className="text-xl text-karimoff-orange">×{item.quantity}</strong>
            </div>
            {item.modifiers.map((modifier) => (
              <p
                key={modifier.id}
                className={`mt-2 rounded-md px-3 py-2 text-sm font-black ${
                  modifier.modifier_type === "remove"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-orange-50 text-karimoff-orange"
                }`}
              >
                {modifier.modifier_type === "remove" ? "БЕЗ" : "ДОБАВИТЬ"}: {modifier.ingredient_name}
                {modifier.modifier_type === "add" && modifier.quantity > 0 ? ` · ${modifier.quantity} ${modifier.unit}` : ""}
              </p>
            ))}
          </section>
        ))}
      </div>

      {order.comment ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Комментарий: {order.comment}
        </div>
      ) : null}

      <form action={updateOrderStatusAction} className="mt-5">
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="status" value={nextStatus} />
        <input type="hidden" name="return_to" value="/admin/kitchen" />
        <button type="submit" className="kitchen-action">
          {order.status === "new" ? <ChefHat size={22} /> : <CheckCircle2 size={22} />}
          {actionLabel}
        </button>
      </form>
    </article>
  );
}

export function KitchenBoard({ orders }: { orders: AdminOrder[] }) {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [router]);

  const newOrders = orders.filter((order) => order.status === "new");
  const activeOrders = orders.filter((order) => order.status === "in_progress");

  return (
    <div className="grid gap-7">
      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-black">Готовятся</h2>
          <span className="kitchen-count">{activeOrders.length}</span>
        </div>
        {activeOrders.length ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {activeOrders.map((order) => <OrderCard key={order.id} order={order} />)}
          </div>
        ) : (
          <div className="admin-empty mt-4">Сейчас ничего не готовится.</div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-black">Новые</h2>
          <span className="kitchen-count kitchen-count-orange">{newOrders.length}</span>
        </div>
        {newOrders.length ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {newOrders.map((order) => <OrderCard key={order.id} order={order} />)}
          </div>
        ) : (
          <div className="admin-empty mt-4">Новых заказов пока нет.</div>
        )}
      </section>
    </div>
  );
}
