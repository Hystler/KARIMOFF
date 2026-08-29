"use client";

import { Check, Circle, Clock3, RefreshCw, Wifi } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomerOrder, CustomerOrderStatus } from "@/lib/customer-orders";
import { RepeatOrderButton } from "./RepeatOrderButton";

type OrderPresentation = {
  description: string;
  label: string;
  tone: "amber" | "emerald" | "muted" | "orange" | "red";
};

const toneClasses = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  muted: "border-karimoff-line bg-karimoff-soft text-karimoff-muted",
  orange: "border-orange-200 bg-orange-50 text-karimoff-orange",
  red: "border-red-200 bg-red-50 text-red-700"
} as const;

const progressSteps = ["Принят", "Готовим", "Готов", "Выдан"];

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow"
  }).format(new Date(date));
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function presentation(order: CustomerOrder): OrderPresentation {
  if (order.status === "cancelled" || order.kitchen_status === "cancelled") {
    return { label: "Отменён", description: "Заказ отменён и не передан на кухню.", tone: "red" };
  }
  if (order.payment_status === "failed" || order.payment_status === "cancelled") {
    return { label: "Оплата не прошла", description: "Эта попытка оплаты завершена без списания.", tone: "red" };
  }
  if (order.payment_status === "pending") {
    return { label: "Ожидает оплаты", description: "Платёж ещё не подтверждён, на кухню заказ не передан.", tone: "amber" };
  }
  if (order.payment_status === "refunded") {
    return { label: "Возвращён", description: "Оплата по заказу возвращена.", tone: "muted" };
  }
  if (order.kitchen_status === "handed_out") {
    return { label: "Выдан", description: "Заказ передан вам. Спасибо!", tone: "emerald" };
  }
  if (order.kitchen_status === "ready") {
    return { label: "Готов к выдаче", description: "Можно забирать заказ в KARIMOFF.", tone: "emerald" };
  }
  if (order.kitchen_status === "cooking") {
    return { label: "Готовим", description: "Кухня уже готовит ваш заказ.", tone: "orange" };
  }
  return { label: "Заказ принят", description: "Оплата подтверждена, заказ передан на кухню.", tone: "orange" };
}

function completedStep(order: CustomerOrder) {
  if (order.kitchen_status === "handed_out") return 3;
  if (order.kitchen_status === "ready") return 2;
  if (order.kitchen_status === "cooking") return 1;
  return 0;
}

function OrderProgress({ order }: { order: CustomerOrder }) {
  if (!["paid", "partially_refunded"].includes(order.payment_status) || order.kitchen_status === "cancelled") {
    return null;
  }
  const active = completedStep(order);
  return (
    <ol className="mt-5 grid grid-cols-4 gap-1" aria-label="Статус приготовления">
      {progressSteps.map((step, index) => {
        const done = index <= active;
        return (
          <li key={step} className="min-w-0 text-center">
            <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border ${done ? "border-karimoff-orange bg-karimoff-orange text-white" : "border-karimoff-line bg-white text-karimoff-muted"}`}>
              {done ? <Check size={15} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
            </span>
            <span className={`mt-2 block text-[10px] font-bold sm:text-xs ${done ? "text-karimoff-black" : "text-karimoff-muted"}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function CustomerOrdersLive({
  initialOrders,
  preview = false
}: {
  initialOrders: CustomerOrder[];
  preview?: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [connection, setConnection] = useState<"live" | "refreshing" | "offline">("live");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    setConnection("refreshing");
    try {
      const response = await fetch("/api/customer/orders", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        orders?: CustomerOrderStatus[];
      } | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.orders)) {
        setConnection("offline");
        return;
      }
      const statusById = new Map(payload.orders.map((order) => [order.id, order]));
      setOrders((current) => current.map((order) => {
        const status = statusById.get(order.id);
        return status ? { ...order, ...status } : order;
      }));
      setConnection("live");
    } catch {
      setConnection("offline");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 5_000);
    const resume = () => void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const visibleOrders = useMemo(() => preview ? orders.slice(0, 3) : orders, [orders, preview]);

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-karimoff-orange">Личный кабинет</p>
          <h2 className="mt-1 text-2xl font-black">{preview ? "Последние заказы" : "Мои заказы"}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 text-xs font-bold ${connection === "offline" ? "text-amber-700" : "text-emerald-700"}`} role="status" aria-live="polite">
            {connection === "refreshing" ? <RefreshCw className="animate-spin" size={14} /> : connection === "live" ? <Wifi size={14} /> : <Clock3 size={14} />}
            {connection === "offline" ? "Обновим при восстановлении связи" : "Статусы обновляются"}
          </span>
          {preview ? <Link href="/profile/orders" className="text-sm font-bold text-karimoff-orange">Все заказы</Link> : null}
        </div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-karimoff-line p-6 text-center">
          <p className="font-bold">Заказов пока нет</p>
          <p className="mt-2 text-sm text-karimoff-muted">Выберите что-нибудь вкусное в меню.</p>
          <Link href="/menu" className="public-button-primary mt-5">Открыть меню</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {visibleOrders.map((order) => {
            const state = presentation(order);
            const canRepeat = ["paid", "partially_refunded", "refunded"].includes(order.payment_status);
            return (
              <article key={order.id} className="rounded-lg border border-karimoff-line p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black">Заказ {order.display_number}</h3>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${toneClasses[state.tone]}`}>{state.label}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-karimoff-muted">{formatDate(order.created_at)} · {order.delivery_type === "delivery" ? "Доставка" : "Самовывоз"}</p>
                    <p className="mt-2 text-sm leading-6 text-karimoff-muted">{state.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <p className="text-xl font-black text-karimoff-orange">{formatPrice(order.total)} ₽</p>
                    {canRepeat && order.items.length ? <RepeatOrderButton items={order.items} orderId={order.id} /> : null}
                  </div>
                </div>

                <OrderProgress order={order} />

                <div className="mt-5 grid gap-2 border-t border-karimoff-line pt-4">
                  {order.items.map((item) => (
                    <div key={item.id}>
                      <p className="text-sm leading-6 text-karimoff-muted">
                        {item.product_name} × {item.quantity} — {formatPrice(item.line_total)} ₽
                      </p>
                      {item.modifiers.map((modifier) => (
                        <p key={modifier.id} className="text-xs font-semibold text-karimoff-orange">
                          {modifier.modifier_type === "remove" ? "Без" : modifier.modifier_type === "replace" ? "Замена" : "Добавить"}: {modifier.ingredient_name}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>

                {order.fiscal_status === "failed" ? (
                  <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Оплата подтверждена. Регистрацию электронного чека проверяет команда KARIMOFF.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
