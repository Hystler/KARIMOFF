"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { createOrderAction, getCheckoutContextAction } from "@/app/actions/orders";
import { initialOrderActionState } from "@/lib/order-schema";
import { useCart } from "./CartProvider";

type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
};

type CheckoutSettings = {
  delivery_enabled: boolean;
  pickup_enabled: boolean;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function CartDrawer() {
  const { clearCart, closeCart, decrement, increment, isOpen, lines, removeItem, totalPrice, checkout } = useCart();
  const [mode, setMode] = useState<"cart" | "auth" | "checkout" | "success">("cart");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [checkoutSettings, setCheckoutSettings] = useState<CheckoutSettings>({
    delivery_enabled: true,
    pickup_enabled: true
  });
  const [isCustomerLoading, setIsCustomerLoading] = useState(false);
  const [orderState, orderFormAction, isOrderPending] = useActionState(createOrderAction, initialOrderActionState);
  const cartPayload = useMemo(() => JSON.stringify(lines), [lines]);
  const isCheckoutDisabled = !checkoutSettings.pickup_enabled && !checkoutSettings.delivery_enabled;

  const startCheckout = useCallback(async () => {
    if (!lines.length) {
      return;
    }

    setIsCustomerLoading(true);
    const context = await getCheckoutContextAction();
    setIsCustomerLoading(false);

    if (!context.customer) {
      setMode("auth");
      return;
    }

    setCheckoutSettings(context.settings);
    setDeliveryType(context.settings.pickup_enabled ? "pickup" : "delivery");
    setCustomer(context.customer);
    setMode("checkout");
  }, [lines.length]);

  useEffect(() => {
    function handleCheckoutRequest() {
      void startCheckout();
    }

    window.addEventListener("karimoff-cart-checkout-request", handleCheckoutRequest);
    return () => window.removeEventListener("karimoff-cart-checkout-request", handleCheckoutRequest);
  }, [startCheckout]);

  useEffect(() => {
    if (orderState.status === "success") {
      const timeoutId = window.setTimeout(() => {
        clearCart();
        setMode("success");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [clearCart, orderState.status]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Закрыть корзину"
        className="absolute inset-0 bg-karimoff-black/24 backdrop-blur-[2px]"
        onClick={closeCart}
      />
      <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col bg-white shadow-2xl sm:rounded-l-[2rem]">
        <div className="flex items-center justify-between border-b border-karimoff-line p-5">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Корзина</p>
            <h2 className="mt-1 text-3xl font-black text-karimoff-black">
              {mode === "checkout" ? "Оформление" : mode === "success" ? "Готово" : "Ваш заказ"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode("cart");
              closeCart();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-karimoff-line text-xl leading-none transition hover:border-karimoff-orange hover:text-karimoff-orange"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {mode === "success" ? (
            <div className="rounded-lg border border-karimoff-orange/25 bg-karimoff-orange/10 p-6">
              <p className="text-lg font-black text-karimoff-black">Заказ отправлен.</p>
              <p className="mt-2 text-sm leading-6 text-karimoff-muted">
                Мы свяжемся с вами для подтверждения.
              </p>
              {orderState.orderId ? (
                <p className="mt-4 text-xs font-semibold text-karimoff-muted">ID заказа: {orderState.orderId}</p>
              ) : null}
            </div>
          ) : lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-karimoff-line bg-karimoff-cream p-6 text-sm leading-6 text-karimoff-muted">
              Корзина пока пустая. Добавьте бургер из меню, и он появится здесь.
            </div>
          ) : mode === "auth" ? (
            <div className="rounded-lg border border-karimoff-line bg-karimoff-cream p-6">
              <p className="text-xl font-black text-karimoff-black">Чтобы оформить заказ, войдите или зарегистрируйтесь</p>
              <p className="mt-3 text-sm leading-6 text-karimoff-muted">
                Так мы подтянем имя и телефон из профиля и не попросим вводить их каждый раз.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link
                  href="/login?next=checkout"
                  className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-center text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
                >
                  Войти
                </Link>
                <Link
                  href="/register?next=checkout"
                  className="rounded-full border border-karimoff-orange bg-white px-5 py-3 text-center text-sm font-bold text-karimoff-orange transition hover:-translate-y-0.5 hover:bg-karimoff-orange hover:text-white"
                >
                  Зарегистрироваться
                </Link>
              </div>
            </div>
          ) : mode === "checkout" && customer ? (
            <form action={orderFormAction} className="grid gap-5">
              <input type="hidden" name="cart" value={cartPayload} />
              <section className="rounded-lg border border-karimoff-line bg-karimoff-cream p-4">
                <p className="text-sm font-semibold text-karimoff-orange">Ваши данные</p>
                <div className="mt-3 grid gap-2 text-sm">
                  <p>
                    <span className="text-karimoff-muted">Имя: </span>
                    <span className="font-bold text-karimoff-black">{customer.name}</span>
                  </p>
                  <p>
                    <span className="text-karimoff-muted">Телефон: </span>
                    <span className="font-bold text-karimoff-black">{customer.phone}</span>
                  </p>
                </div>
              </section>

              <section className="rounded-lg border border-karimoff-line bg-white p-4">
                <p className="text-sm font-bold text-karimoff-black">Тип получения</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-full border border-karimoff-line px-4 py-3 text-sm font-semibold">
                    <input
                      type="radio"
                      name="delivery_type"
                      value="pickup"
                      checked={deliveryType === "pickup"}
                      disabled={!checkoutSettings.pickup_enabled}
                      onChange={() => setDeliveryType("pickup")}
                      className="accent-karimoff-orange"
                    />
                    {checkoutSettings.pickup_enabled ? "Самовывоз" : "Самовывоз недоступен"}
                  </label>
                  <label className="flex items-center gap-2 rounded-full border border-karimoff-line px-4 py-3 text-sm font-semibold">
                    <input
                      type="radio"
                      name="delivery_type"
                      value="delivery"
                      checked={deliveryType === "delivery"}
                      disabled={!checkoutSettings.delivery_enabled}
                      onChange={() => setDeliveryType("delivery")}
                      className="accent-karimoff-orange"
                    />
                    {checkoutSettings.delivery_enabled ? "Доставка" : "Доставка недоступна"}
                  </label>
                </div>
                {isCheckoutDisabled ? (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    Оформление заказа временно недоступно.
                  </p>
                ) : null}
                {deliveryType === "delivery" ? (
                  <label className="mt-4 grid gap-2 text-sm font-semibold text-karimoff-muted">
                    Адрес доставки
                    <input
                      name="address"
                      required
                      className="h-[48px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                      placeholder="Улица, дом, квартира"
                    />
                  </label>
                ) : null}
                <label className="mt-4 grid gap-2 text-sm font-semibold text-karimoff-muted">
                  Комментарий
                  <textarea
                    name="comment"
                    rows={3}
                    className="resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                    placeholder="Пожелания к заказу"
                  />
                </label>
              </section>

              <section className="rounded-lg border border-karimoff-line bg-white p-4">
                <p className="text-sm font-bold text-karimoff-black">Состав заказа</p>
                <div className="mt-3 grid gap-3">
                  {lines.map((line) => (
                    <div key={line.product.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-karimoff-muted">
                        {line.product.name} × {line.quantity}
                      </span>
                      <span className="font-black text-karimoff-black">
                        {formatPrice(line.product.price * line.quantity)} ₽
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-karimoff-line pt-4 text-lg font-black">
                  <span>Итого</span>
                  <span className="text-karimoff-orange">{formatPrice(totalPrice)} ₽</span>
                </div>
              </section>

              {orderState.status === "error" ? (
                <p className="text-sm font-semibold text-red-600">{orderState.message}</p>
              ) : null}

              <button
                type="submit"
                disabled={isOrderPending || !lines.length || isCheckoutDisabled}
                className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isOrderPending ? "Отправляем заказ" : "Отправить заказ"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => (
                <article key={line.product.id} className="rounded-lg border border-karimoff-line bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-karimoff-black">{line.product.name}</h3>
                      <p className="mt-1 text-sm font-bold text-karimoff-orange">{formatPrice(line.product.price)} ₽</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(line.product.id)}
                      className="text-sm font-semibold text-karimoff-muted transition hover:text-red-600"
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center rounded-full border border-karimoff-line">
                      <button
                        type="button"
                        onClick={() => decrement(line.product.id)}
                        className="h-9 w-10 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Уменьшить количество"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increment(line.product.id)}
                        className="h-9 w-10 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Увеличить количество"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-base font-black text-karimoff-black">
                      {formatPrice(line.quantity * line.product.price)} ₽
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {mode !== "success" ? (
        <div className="border-t border-karimoff-line p-5">
          <div className="mb-4 flex items-center justify-between text-lg font-black">
            <span>Итого</span>
            <span className="text-karimoff-orange">{formatPrice(totalPrice)} ₽</span>
          </div>
          <div className="grid gap-3">
            {mode === "cart" || mode === "auth" ? (
              <button
                type="button"
                onClick={checkout}
                disabled={!lines.length || isCustomerLoading}
                className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isCustomerLoading ? "Проверяем профиль" : "Оформить заказ"}
              </button>
            ) : null}
            {lines.length && mode !== "checkout" ? (
              <button
                type="button"
                onClick={clearCart}
                className="rounded-full border border-karimoff-line px-6 py-3 text-sm font-semibold transition hover:border-karimoff-orange hover:text-karimoff-orange"
              >
                Очистить корзину
              </button>
            ) : null}
          </div>
        </div>
        ) : null}
      </aside>
    </div>
  );
}
