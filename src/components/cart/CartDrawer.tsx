"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { createOrderAction, getCheckoutContextAction } from "@/app/actions/orders";
import { initialOrderActionState } from "@/lib/order-schema";
import {
  getMoscowDateKey,
  getSameDayOrderSlots,
  moscowOrderSlotToIso
} from "@/lib/order-time";
import { getCartLineUnitPrice, useCart, type CartLine } from "./CartProvider";
import { CartLineCustomizer } from "./CartLineCustomizer";
import { ScheduledTimeSlider } from "./ScheduledTimeSlider";

type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
};

type CheckoutSettings = {
  delivery_enabled: boolean;
  online_payments_enabled: boolean;
  pickup_enabled: boolean;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function selectedGroupLabels(line: CartLine) {
  const options = new Map(
    (line.product.modifier_groups ?? []).flatMap((group) =>
      group.options.map((option) => [option.id, option.label] as const)
    )
  );
  return line.customization.modifierOptionIds
    .map((optionId) => options.get(optionId))
    .filter((label): label is string => Boolean(label));
}

function CartCustomizationSummary({ line, compact = false }: { line: CartLine; compact?: boolean }) {
  const groups = selectedGroupLabels(line);
  const spacing = compact ? "mt-1" : "mt-2";

  return (
    <>
      {line.customization.removed.length ? (
        <p className={`${spacing} text-xs font-semibold leading-5 text-amber-700`}>
          Без: {line.customization.removed.map((item) => item.name).join(", ")}
        </p>
      ) : null}
      {line.customization.extras.length ? (
        <p className="mt-1 text-xs font-semibold leading-5 text-karimoff-orange">
          Добавить: {line.customization.extras.map((item) => `${item.name} × ${item.quantity}`).join(", ")}
        </p>
      ) : null}
      {groups.length ? (
        <p className="mt-1 text-xs font-semibold leading-5 text-karimoff-black">{groups.join(" · ")}</p>
      ) : null}
      {line.customization.note ? (
        <p className="mt-1 text-xs leading-5 text-karimoff-muted">Комментарий: {line.customization.note}</p>
      ) : null}
    </>
  );
}

export function CartDrawer() {
  const { clearCart, closeCart, decrement, increment, isOpen, lines, openCart, removeItem, totalPrice, checkout } = useCart();
  const [mode, setMode] = useState<"cart" | "auth" | "checkout" | "success">("cart");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [fulfillmentMode, setFulfillmentMode] = useState<"asap" | "scheduled">("asap");
  const [clientNow, setClientNow] = useState(() => new Date());
  const [requestedSlotIndex, setRequestedSlotIndex] = useState(0);
  const [checkoutSettings, setCheckoutSettings] = useState<CheckoutSettings>({
    delivery_enabled: true,
    online_payments_enabled: false,
    pickup_enabled: true
  });
  const [receiptEmail, setReceiptEmail] = useState("");
  const [isCustomerLoading, setIsCustomerLoading] = useState(false);
  const [checkoutRequestId, setCheckoutRequestId] = useState("");
  const [orderState, orderFormAction, isOrderPending] = useActionState(createOrderAction, initialOrderActionState);
  const cartPayload = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          product_id: line.product.id,
          quantity: line.quantity,
          removed_ingredient_ids: line.customization.removed.map((item) => item.ingredient_id),
          extras: line.customization.extras.map((item) => ({
            ingredient_id: item.ingredient_id,
            quantity: item.quantity
          })),
          modifier_option_ids: line.customization.modifierOptionIds,
          note: line.customization.note
        }))
      ),
    [lines]
  );
  const isCheckoutDisabled = !checkoutSettings.pickup_enabled && !checkoutSettings.delivery_enabled;
  const scheduledSlots = useMemo(
    () => (clientNow ? getSameDayOrderSlots(clientNow) : []),
    [clientNow]
  );
  const requestedAt = useMemo(() => {
    if (fulfillmentMode !== "scheduled" || !clientNow || !scheduledSlots.length) return "";
    const slot = scheduledSlots[Math.min(requestedSlotIndex, scheduledSlots.length - 1)];
    return moscowOrderSlotToIso(getMoscowDateKey(clientNow), slot);
  }, [clientNow, fulfillmentMode, requestedSlotIndex, scheduledSlots]);

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

    setCheckoutSettings({
      ...context.settings,
      online_payments_enabled: context.payment.enabled
    });
    setReceiptEmail(context.payment.receiptEmail);
    setDeliveryType(context.settings.pickup_enabled ? "pickup" : "delivery");
    setCustomer(context.customer);
    setCheckoutRequestId(crypto.randomUUID());
    setClientNow(new Date());
    setRequestedSlotIndex(0);
    setMode("checkout");
  }, [lines.length]);

  useEffect(() => {
    function handleCheckoutRequest() {
      openCart();
      void startCheckout();
    }

    window.addEventListener("karimoff-cart-checkout-request", handleCheckoutRequest);
    return () => window.removeEventListener("karimoff-cart-checkout-request", handleCheckoutRequest);
  }, [openCart, startCheckout]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMode("cart");
        closeCart();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeCart, isOpen]);

  useEffect(() => {
    if (orderState.status === "success") {
      if (orderState.paymentConfirmationUrl) {
        window.location.assign(orderState.paymentConfirmationUrl);
        return undefined;
      }
      const timeoutId = window.setTimeout(() => {
        clearCart();
        setMode("success");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [clearCart, orderState.paymentConfirmationUrl, orderState.status]);

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
      <aside
        className="absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col bg-white shadow-2xl sm:rounded-l-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
      >
        <div className="flex items-center justify-between border-b border-karimoff-line p-4 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Корзина</p>
            <h2 id="cart-drawer-title" className="mt-1 text-2xl font-black leading-tight text-karimoff-black">
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

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
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
                  href="/login?redirectTo=%2Fcheckout"
                  className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-center text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
                >
                  Войти
                </Link>
                <Link
                  href="/register?redirectTo=%2Fcheckout"
                  className="rounded-full border border-karimoff-orange bg-white px-5 py-3 text-center text-sm font-bold text-karimoff-orange transition hover:-translate-y-0.5 hover:bg-karimoff-orange hover:text-white"
                >
                  Зарегистрироваться
                </Link>
              </div>
            </div>
          ) : mode === "checkout" && customer ? (
            <form action={orderFormAction} className="grid gap-5">
              <input type="hidden" name="cart" value={cartPayload} />
              <input type="hidden" name="idempotency_key" value={checkoutRequestId} />
              <input type="hidden" name="fulfillment_mode" value={fulfillmentMode} />
              <input
                type="hidden"
                name="requested_at"
                value={requestedAt}
              />
              {checkoutSettings.online_payments_enabled ? (
                <section className="rounded-lg border border-karimoff-line bg-white p-4">
                  <p className="text-sm font-bold text-karimoff-black">Email для чека</p>
                  <p className="mt-1 text-xs leading-5 text-karimoff-muted">
                    На эту почту придёт электронный чек. После успешной оплаты мы сохраним адрес в профиле.
                  </p>
                  <label className="mt-3 grid gap-2 text-sm font-semibold text-karimoff-muted">
                    Электронная почта
                    <input
                      type="email"
                      name="receipt_email"
                      value={receiptEmail}
                      onChange={(event) => setReceiptEmail(event.target.value)}
                      required
                      autoComplete="email"
                      inputMode="email"
                      className="h-[48px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                      placeholder="name@example.ru"
                    />
                  </label>
                </section>
              ) : null}
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
                <div className="mt-5 border-t border-karimoff-line pt-5">
                  <p className="text-sm font-bold text-karimoff-black">Когда приготовить</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFulfillmentMode("asap")}
                      className={`min-h-12 rounded-lg border px-3 text-sm font-bold transition ${
                        fulfillmentMode === "asap"
                          ? "border-karimoff-orange bg-karimoff-orange text-white"
                          : "border-karimoff-line bg-white text-karimoff-black hover:border-karimoff-orange"
                      }`}
                    >
                      Как можно скорее
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClientNow(new Date());
                        setRequestedSlotIndex(0);
                        setFulfillmentMode("scheduled");
                      }}
                      disabled={Boolean(clientNow && !scheduledSlots.length)}
                      className={`min-h-12 rounded-lg border px-3 text-sm font-bold transition ${
                        fulfillmentMode === "scheduled"
                          ? "border-karimoff-orange bg-karimoff-orange text-white"
                          : "border-karimoff-line bg-white text-karimoff-black hover:border-karimoff-orange"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      Ко времени
                    </button>
                  </div>
                  {fulfillmentMode === "scheduled" ? (
                    <ScheduledTimeSlider
                      slots={scheduledSlots}
                      value={requestedSlotIndex}
                      onChange={setRequestedSlotIndex}
                    />
                  ) : null}
                </div>
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

              <section className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-cream p-4 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="personal_data_consent"
                    required
                    className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
                  />
                  <span className="leading-6 text-karimoff-muted">
                    Я даю согласие на обработку персональных данных.{" "}
                    <Link href="/legal/personal-data-consent" target="_blank" className="font-bold text-karimoff-orange">
                      Текст согласия
                    </Link>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="offer_acceptance"
                    required
                    className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
                  />
                  <span className="leading-6 text-karimoff-muted">
                    Я принимаю условия{" "}
                    <Link href="/legal/offer" target="_blank" className="font-bold text-karimoff-orange">
                      публичной оферты
                    </Link>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="marketing_consent"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
                  />
                  <span className="leading-6 text-karimoff-muted">
                    Хочу получать акции и предложения KARIMOFF.{" "}
                    <Link href="/legal/marketing-consent" target="_blank" className="font-bold text-karimoff-orange">
                      Условия
                    </Link>
                  </span>
                </label>
              </section>

              <section className="rounded-lg border border-karimoff-line bg-white p-4">
                <p className="text-sm font-bold text-karimoff-black">Состав заказа</p>
                <div className="mt-3 grid gap-3">
                  {lines.map((line) => (
                    <div key={line.lineId} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <span className="text-karimoff-muted">
                          {line.product.name} × {line.quantity}
                        </span>
                        <CartCustomizationSummary line={line} compact />
                      </div>
                      <span className="shrink-0 font-black text-karimoff-black">
                        {formatPrice(getCartLineUnitPrice(line) * line.quantity)} ₽
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

              {!checkoutSettings.online_payments_enabled ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
                  Онлайн-оплата временно недоступна. Заказ не будет создан до перехода в ЮKassa.
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isOrderPending || !lines.length || isCheckoutDisabled || !checkoutRequestId || !checkoutSettings.online_payments_enabled}
                className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isOrderPending ? "Создаём платёж" : "Перейти к оплате"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => (
                <article key={line.lineId} className="rounded-lg border border-karimoff-line bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-karimoff-black">{line.product.name}</h3>
                      <p className="mt-1 text-sm font-bold text-karimoff-orange">{formatPrice(getCartLineUnitPrice(line))} ₽</p>
                      <CartCustomizationSummary line={line} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(line.lineId)}
                      className="-mr-2 min-h-11 rounded-md px-2 text-sm font-semibold text-karimoff-muted transition hover:bg-red-50 hover:text-red-600"
                    >
                      Удалить
                    </button>
                  </div>
                  <CartLineCustomizer line={line} />
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center rounded-full border border-karimoff-line">
                      <button
                        type="button"
                        onClick={() => decrement(line.lineId)}
                        className="h-11 w-11 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Уменьшить количество"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increment(line.lineId)}
                        className="h-11 w-11 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Увеличить количество"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-base font-black text-karimoff-black">
                      {formatPrice(line.quantity * getCartLineUnitPrice(line))} ₽
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {mode !== "success" ? (
        <div className="border-t border-karimoff-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
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
