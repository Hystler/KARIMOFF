"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOrderAction,
  getCheckoutContextAction,
  listDeliveryHousesAction,
  suggestDeliveryStreetsAction,
  validateDeliveryAddressAction
} from "@/app/actions/orders";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";
import { getDeliveryAcceptanceState } from "@/lib/delivery/hours";
import { initialOrderActionState } from "@/lib/order-schema";
import {
  getOrCreateCheckoutRequestId,
  rememberCheckoutPayment
} from "@/lib/cart-checkout-storage";
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
  delivery_fee: number;
  free_delivery_threshold: number;
  delivery_eta_minutes: number;
  delivery_acceptance_start: string;
  delivery_acceptance_end: string;
  delivery_timezone: string;
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
        <p className="mt-1 text-xs font-semibold leading-5 text-karimoff-orange-contrast">
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
  const { clearCart, closeCart, decrement, increment, isOpen, lines, openCart, removeItem, totalPrice, checkout, repeatOrderIssues } = useCart();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"cart" | "auth" | "checkout" | "success">("cart");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [deliveryStreetQuery, setDeliveryStreetQuery] = useState("");
  const [selectedDeliveryStreet, setSelectedDeliveryStreet] = useState("");
  const [deliveryStreetSuggestions, setDeliveryStreetSuggestions] = useState<string[]>([]);
  const [deliveryHouseOptions, setDeliveryHouseOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [deliveryAddressId, setDeliveryAddressId] = useState("");
  const [deliveryCheck, setDeliveryCheck] = useState<{
    addressId: string;
    available: boolean;
    message: string;
  } | null>(null);
  const [isSearchingDeliveryStreets, setIsSearchingDeliveryStreets] = useState(false);
  const [isLoadingDeliveryHouses, setIsLoadingDeliveryHouses] = useState(false);
  const [isCheckingDeliveryAddress, setIsCheckingDeliveryAddress] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] = useState<"asap" | "scheduled">("asap");
  const [clientNow, setClientNow] = useState(() => new Date());
  const [requestedSlotIndex, setRequestedSlotIndex] = useState(0);
  const [checkoutSettings, setCheckoutSettings] = useState<CheckoutSettings>({
    delivery_enabled: true,
    online_payments_enabled: false,
    pickup_enabled: true,
    delivery_fee: 200,
    free_delivery_threshold: 2500,
    delivery_eta_minutes: 60,
    delivery_acceptance_start: "11:00",
    delivery_acceptance_end: "20:30",
    delivery_timezone: "Europe/Moscow"
  });
  const [stagingUiMode, setStagingUiMode] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [marketingChoiceMade, setMarketingChoiceMade] = useState(false);
  const [isCustomerLoading, setIsCustomerLoading] = useState(false);
  const [checkoutContextError, setCheckoutContextError] = useState<string | null>(null);
  const [checkoutRequestId, setCheckoutRequestId] = useState("");
  const checkoutContextPending = useRef(false);
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
  const deliveryFee = deliveryType === "delivery"
    ? (totalPrice >= checkoutSettings.free_delivery_threshold ? 0 : checkoutSettings.delivery_fee)
    : 0;
  const checkoutTotal = totalPrice + deliveryFee;
  const addressIsValidated = Boolean(deliveryAddressId)
    && !isCheckingDeliveryAddress
    && deliveryCheck?.available === true
    && deliveryCheck.addressId === deliveryAddressId;
  const deliveryAcceptanceState = clientNow
    ? getDeliveryAcceptanceState(clientNow, {
      timezone: checkoutSettings.delivery_timezone,
      acceptanceStart: checkoutSettings.delivery_acceptance_start,
      acceptanceEnd: checkoutSettings.delivery_acceptance_end
    })
    : "before";
  const scheduledSlots = useMemo(
    () => (clientNow ? getSameDayOrderSlots(clientNow) : []),
    [clientNow]
  );
  const requestedAt = useMemo(() => {
    if (fulfillmentMode !== "scheduled" || !clientNow || !scheduledSlots.length) return "";
    const slot = scheduledSlots[Math.min(requestedSlotIndex, scheduledSlots.length - 1)];
    return moscowOrderSlotToIso(getMoscowDateKey(clientNow), slot);
  }, [clientNow, fulfillmentMode, requestedSlotIndex, scheduledSlots]);

  const clearDeliveryAddressSelection = useCallback(() => {
    setDeliveryStreetQuery("");
    setSelectedDeliveryStreet("");
    setDeliveryStreetSuggestions([]);
    setDeliveryHouseOptions([]);
    setDeliveryAddressId("");
    setDeliveryCheck(null);
    setIsSearchingDeliveryStreets(false);
    setIsLoadingDeliveryHouses(false);
    setIsCheckingDeliveryAddress(false);
  }, []);

  useEffect(() => {
    if (deliveryType !== "delivery" || !deliveryStreetQuery.trim() || selectedDeliveryStreet) {
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setIsSearchingDeliveryStreets(true);
      void suggestDeliveryStreetsAction(deliveryStreetQuery).then((result) => {
        if (active) setDeliveryStreetSuggestions(result.streets);
      }).catch(() => {
        if (active) setDeliveryStreetSuggestions([]);
      }).finally(() => {
        if (active) setIsSearchingDeliveryStreets(false);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [deliveryStreetQuery, deliveryType, selectedDeliveryStreet]);

  useEffect(() => {
    if (!selectedDeliveryStreet || deliveryType !== "delivery") {
      return undefined;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return null;
      setIsLoadingDeliveryHouses(true);
      return listDeliveryHousesAction(selectedDeliveryStreet);
    }).then((result) => {
      if (!result) return;
      if (active) setDeliveryHouseOptions(result.houses);
    }).catch(() => {
      if (active) setDeliveryHouseOptions([]);
    }).finally(() => {
      if (active) setIsLoadingDeliveryHouses(false);
    });
    return () => { active = false; };
  }, [deliveryType, selectedDeliveryStreet]);

  const startCheckout = useCallback(async () => {
    if (!lines.length || checkoutContextPending.current) {
      return;
    }

    checkoutContextPending.current = true;
    setIsCustomerLoading(true);
    setCheckoutContextError(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const context = await Promise.race([
        getCheckoutContextAction(),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error("CHECKOUT_CONTEXT_TIMEOUT")), 10_000);
        })
      ]);

      if (!context.customer) {
        setMode("auth");
        return;
      }

      setStagingUiMode(context.stagingUiMode === true);
      setCheckoutSettings({
        ...context.settings,
        online_payments_enabled: context.payment.enabled
      });
      setReceiptEmail(context.payment.receiptEmail);
      setMarketingChoiceMade(context.marketingChoiceMade);
      setDeliveryType(context.settings.pickup_enabled ? "pickup" : "delivery");
      setCustomer(context.customer);
      setCheckoutRequestId(getOrCreateCheckoutRequestId(cartPayload));
      setClientNow(new Date());
      setRequestedSlotIndex(0);
      setMode("checkout");
    } catch {
      setMode("cart");
      setCheckoutContextError("Не удалось открыть оформление. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      checkoutContextPending.current = false;
      setIsCustomerLoading(false);
    }
  }, [cartPayload, lines.length]);

  const leaveCartForAuth = useCallback(() => {
    setCheckoutContextError(null);
    setMode("cart");
    closeCart();
  }, [closeCart]);

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
    const previouslyFocused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

    function getFocusableElements() {
      return Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => !element.hasAttribute("aria-hidden") && element.offsetParent !== null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMode("cart");
        closeCart();
        return;
      }

      if (event.key === "Tab") {
        const focusable = getFocusableElements();
        if (!focusable.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleEscape);
      if (previouslyFocused?.isConnected) {
        window.setTimeout(() => previouslyFocused.focus({ preventScroll: true }), 0);
      }
    };
  }, [closeCart, isOpen]);

  useEffect(() => {
    if (mode !== "checkout") return undefined;
    const timer = window.setInterval(() => setClientNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (orderState.status !== "success" || !orderState.stagingPreview) return undefined;
    // Each preview response is new even when the previous preview also succeeded.
    const timeoutId = window.setTimeout(() => setMode("success"), 0);
    return () => window.clearTimeout(timeoutId);
  }, [orderState]);

  useEffect(() => {
    if (orderState.status === "success") {
      if (orderState.stagingPreview) {
        return undefined;
      }
      if (orderState.paymentConfirmationUrl) {
        if (orderState.paymentId && checkoutRequestId) {
          rememberCheckoutPayment({
            cartPayload,
            idempotencyKey: checkoutRequestId,
            paymentId: orderState.paymentId
          });
        }
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
  }, [cartPayload, checkoutRequestId, clearCart, orderState.paymentConfirmationUrl, orderState.paymentId, orderState.stagingPreview, orderState.status]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-karimoff-black/24 backdrop-blur-[2px]"
        onClick={closeCart}
      />
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-overlay sm:rounded-l-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
      >
        <div className="flex items-center justify-between border-b border-karimoff-line p-4 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange-contrast">Корзина</p>
            <h2 id="cart-drawer-title" className="mt-1 text-2xl font-black leading-tight text-karimoff-black">
              {mode === "checkout" ? "Оформление" : mode === "success" ? "Готово" : "Ваш заказ"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => {
              setMode("cart");
              closeCart();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-karimoff-line text-xl leading-none transition hover:border-karimoff-orange-contrast hover:text-karimoff-orange-contrast"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {repeatOrderIssues.length > 0 && mode !== "success" ? (
            <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
              <p className="font-bold">Не всё из прошлого заказа доступно</p>
              <p className="mt-1">В корзине — доступные позиции по текущим ценам. Не добавились:</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {repeatOrderIssues.map(issue => <li key={issue.itemId}><span className="font-semibold">{issue.name}</span> — {issue.reason}</li>)}
              </ul>
            </div>
          ) : null}
          {mode === "success" ? (
            <div className="rounded-lg border border-karimoff-orange/25 bg-karimoff-orange/10 p-6">
              <p className="text-lg font-black text-karimoff-black">
                {orderState.stagingPreview ? "Проверка оформления пройдена." : "Заказ отправлен."}
              </p>
              <p className="mt-2 text-sm leading-6 text-karimoff-muted">
                {orderState.stagingPreview
                  ? orderState.message
                  : "Мы свяжемся с вами для подтверждения."}
              </p>
              {orderState.orderId ? (
                <p className="mt-4 text-xs font-semibold text-karimoff-muted">ID заказа: {orderState.orderId}</p>
              ) : null}
              {orderState.stagingPreview ? (
                <button
                  type="button"
                  onClick={() => setMode("checkout")}
                  className="public-button-secondary mt-5 w-full"
                >
                  Вернуться к оформлению
                </button>
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
                <AuthDocumentLink
                  href="/login?redirectTo=%2Fcheckout"
                  onClick={leaveCartForAuth}
                  className="public-button-primary px-5 text-center"
                >
                  Войти
                </AuthDocumentLink>
                <AuthDocumentLink
                  href="/register?redirectTo=%2Fcheckout"
                  onClick={leaveCartForAuth}
                  className="public-button-secondary px-5 text-center"
                >
                  Зарегистрироваться
                </AuthDocumentLink>
              </div>
            </div>
          ) : mode === "checkout" && customer ? (
            <form action={orderFormAction} className="grid gap-5">
              {stagingUiMode ? (
                <p role="status" className="rounded-md border border-karimoff-orange/25 bg-karimoff-orange/10 px-3 py-2 text-sm font-semibold leading-5 text-karimoff-black">
                  Тестовый режим. Заказы и платежи не создаются.
                </p>
              ) : null}
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
                      className="public-field"
                      placeholder="name@example.ru"
                    />
                  </label>
                </section>
              ) : null}
              <section className="rounded-lg border border-karimoff-line bg-karimoff-cream p-4">
                <p className="text-sm font-semibold text-karimoff-orange-contrast">Ваши данные</p>
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
                      onChange={() => {
                        clearDeliveryAddressSelection();
                        setDeliveryType("pickup");
                      }}
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
                      onChange={() => {
                        clearDeliveryAddressSelection();
                        setDeliveryType("delivery");
                        setFulfillmentMode("asap");
                      }}
                      className="accent-karimoff-orange"
                    />
                    {checkoutSettings.delivery_enabled ? "Доставка" : "Доставка пока недоступна"}
                  </label>
                </div>
                {!checkoutSettings.delivery_enabled ? (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900">
                    Доставка пока недоступна. Вы можете оформить самовывоз.
                  </p>
                ) : null}
                {isCheckoutDisabled ? (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    Оформление заказа временно недоступно.
                  </p>
                ) : null}
                {deliveryType === "delivery" ? (
                  <div className="mt-4 grid gap-3">
                    <input type="hidden" name="delivery_address_id" value={deliveryAddressId} />
                    <label className="grid gap-2 text-sm font-semibold text-karimoff-muted">
                      Улица
                      <input
                        value={deliveryStreetQuery}
                        onChange={(event) => {
                          setDeliveryStreetQuery(event.target.value);
                          setSelectedDeliveryStreet("");
                          setDeliveryStreetSuggestions([]);
                          setIsSearchingDeliveryStreets(false);
                          setDeliveryHouseOptions([]);
                          setIsLoadingDeliveryHouses(false);
                          setDeliveryAddressId("");
                          setDeliveryCheck(null);
                        }}
                        autoComplete="off"
                        aria-label="Улица доставки"
                        className="public-field min-w-0"
                        placeholder="Начните вводить название улицы"
                      />
                    </label>
                    {deliveryStreetSuggestions.length ? (
                      <ul className="-mt-2 overflow-hidden rounded-md border border-karimoff-line bg-white" aria-label="Улицы из списка доставки">
                        {deliveryStreetSuggestions.map((street) => (
                          <li key={street}>
                            <button
                              type="button"
                              className="w-full px-3 py-3 text-left text-sm leading-5 text-karimoff-black hover:bg-karimoff-cream"
                              onClick={() => {
                                setSelectedDeliveryStreet(street);
                                setDeliveryStreetQuery(street);
                                setDeliveryStreetSuggestions([]);
                                setIsSearchingDeliveryStreets(false);
                                setDeliveryHouseOptions([]);
                                setIsLoadingDeliveryHouses(false);
                                setDeliveryAddressId("");
                                setDeliveryCheck(null);
                              }}
                            >
                              {street}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {isSearchingDeliveryStreets ? <p className="-mt-2 text-xs text-karimoff-muted">Ищем улицу…</p> : null}
                    {deliveryStreetQuery.trim() && !selectedDeliveryStreet && !isSearchingDeliveryStreets && !deliveryStreetSuggestions.length ? (
                      <p role="status" className="-mt-2 text-sm text-karimoff-muted">
                        По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз.
                      </p>
                    ) : null}
                    <label className="grid gap-2 text-sm font-semibold text-karimoff-muted">
                      Дом
                      <select
                        value={deliveryAddressId}
                        disabled={!selectedDeliveryStreet || isLoadingDeliveryHouses || !deliveryHouseOptions.length}
                        aria-label="Дом доставки"
                        className="public-field min-w-0"
                        onChange={(event) => {
                          const addressId = event.target.value;
                          setDeliveryAddressId(addressId);
                          setDeliveryCheck(null);
                          if (!addressId) return;
                          setIsCheckingDeliveryAddress(true);
                          void validateDeliveryAddressAction({ deliveryAddressId: addressId }).then((result) => {
                            setDeliveryCheck({ addressId, available: result.available, message: result.message });
                          }).catch(() => {
                            setDeliveryCheck({
                              addressId,
                              available: false,
                              message: "По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз."
                            });
                          }).finally(() => setIsCheckingDeliveryAddress(false));
                        }}
                      >
                        <option value="">{isLoadingDeliveryHouses ? "Загружаем дома…" : "Выберите дом"}</option>
                        {deliveryHouseOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    {selectedDeliveryStreet && !isLoadingDeliveryHouses && !deliveryHouseOptions.length ? (
                      <p role="status" className="-mt-2 text-sm text-karimoff-muted">
                        По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз.
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["delivery_apartment", "Квартира", "12"],
                        ["delivery_entrance", "Подъезд", "2"],
                        ["delivery_floor", "Этаж", "3"],
                        ["delivery_intercom", "Домофон", "Код"]
                      ].map(([name, label, placeholder]) => (
                        <label key={name} className="grid gap-1.5 text-xs font-semibold text-karimoff-muted">
                          {label}
                          <input
                            name={name}
                            maxLength={name === "delivery_intercom" ? 60 : 30}
                            className="public-field h-11 min-w-0 px-3 text-sm"
                            placeholder={placeholder}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="grid gap-2 text-sm font-semibold text-karimoff-muted">
                      Комментарий курьеру
                      <textarea
                        name="delivery_courier_comment"
                        rows={2}
                        maxLength={500}
                        className="public-field min-h-20 resize-none py-3"
                        placeholder="Как найти вход или квартиру"
                      />
                    </label>
                    {isCheckingDeliveryAddress ? <p role="status" className="text-sm text-karimoff-muted">Проверяем адрес…</p> : null}
                    {deliveryCheck?.addressId === deliveryAddressId ? (
                      <p role={deliveryCheck.available ? "status" : "alert"} className={`text-sm font-semibold ${deliveryCheck.available ? "text-emerald-700" : "text-red-700"}`}>
                        {deliveryCheck.message}
                        {deliveryCheck.available ? ` Доставка ${deliveryFee ? `${formatPrice(deliveryFee)} ₽` : "бесплатно"}.` : ""}
                      </p>
                    ) : null}
                    {deliveryAcceptanceState === "open" ? (
                      <p className="text-xs leading-5 text-karimoff-muted">
                        Доставим в течение {checkoutSettings.delivery_eta_minutes} минут. Принимаем заказы {checkoutSettings.delivery_acceptance_start}–{checkoutSettings.delivery_acceptance_end} по московскому времени.
                      </p>
                    ) : (
                      <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
                        {deliveryAcceptanceState === "after"
                          ? "Сегодня доставка уже закончилась. Вы можете оформить самовывоз."
                          : `Приём заказов на доставку начнётся в ${checkoutSettings.delivery_acceptance_start}. Пока можно оформить самовывоз.`}
                      </p>
                    )}
                  </div>
                ) : null}
                {deliveryType === "pickup" ? <div className="mt-5 border-t border-karimoff-line pt-5">
                  <p className="text-sm font-bold text-karimoff-black">Когда приготовить</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFulfillmentMode("asap")}
                      className={`min-h-12 rounded-lg border px-3 text-sm font-bold transition ${
                        fulfillmentMode === "asap"
                          ? "border-karimoff-orange bg-karimoff-orange text-karimoff-black"
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
                          ? "border-karimoff-orange bg-karimoff-orange text-karimoff-black"
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
                </div> : null}
                <label className="mt-4 grid gap-2 text-sm font-semibold text-karimoff-muted">
                  Комментарий
                  <textarea
                    name="comment"
                    rows={3}
                    className="public-field min-h-[96px] resize-none py-3"
                    placeholder="Пожелания к заказу"
                  />
                </label>
              </section>

              <section className="grid gap-2 border-t border-karimoff-line pt-3 text-xs">
                <p className="leading-5 text-karimoff-muted">
                  Данные используются для оформления и исполнения заказа. {" "}
                  <Link href="/legal/privacy" target="_blank" className="font-bold text-karimoff-orange-contrast">
                    Политика обработки персональных данных
                  </Link>
                </p>
                <p className="leading-5 text-karimoff-muted">
                    Нажимая «Оформить заказ», вы принимаете условия{" "}
                    <Link href="/legal/offer" target="_blank" className="font-bold text-karimoff-orange-contrast">
                      публичной оферты
                    </Link>
                </p>
                {!marketingChoiceMade ? <details className="group">
                  <summary className="flex min-h-8 cursor-pointer items-center gap-2 font-bold text-karimoff-muted">
                    Получать акции KARIMOFF
                    <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
                  </summary>
                  <label className="flex items-start gap-2.5 pb-1 pl-1">
                    <input type="checkbox" name="marketing_consent" className="mt-0.5 h-4 w-4 shrink-0 accent-karimoff-orange" />
                  <span className="leading-5 text-karimoff-muted">Согласен получать акции и предложения. <Link href="/legal/marketing-consent" target="_blank" className="font-bold text-karimoff-orange-contrast">Условия</Link></span>
                  </label>
                </details> : null}
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
                  <div className="w-full">
                    {deliveryType === "delivery" ? (
                      <>
                        <div className="mb-2 flex items-center justify-between text-sm font-semibold text-karimoff-muted">
                          <span>Доставка</span>
                          <span>{deliveryFee ? `${formatPrice(deliveryFee)} ₽` : "Бесплатно"}</span>
                        </div>
                        <p className="mb-3 text-xs font-medium text-karimoff-muted">Бесплатно при заказе от 2 500 ₽</p>
                      </>
                    ) : null}
                    <div className="flex items-center justify-between text-lg font-black">
                      <span>Итого</span>
                      <span className="font-heading text-karimoff-orange-contrast">{formatPrice(checkoutTotal)} ₽</span>
                    </div>
                  </div>
                </div>
              </section>

              {orderState.status === "error" ? (
                <p className="text-sm font-semibold text-red-600">{orderState.message}</p>
              ) : null}

              {!checkoutSettings.online_payments_enabled ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
                  {stagingUiMode
                    ? "Это только preview оформления: заказ и платёж не будут созданы."
                    : "Онлайн-оплата временно недоступна. Заказ не будет создан до перехода в ЮKassa."}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isOrderPending || !lines.length || isCheckoutDisabled || !checkoutRequestId || (!stagingUiMode && !checkoutSettings.online_payments_enabled) || (deliveryType === "delivery" && (!addressIsValidated || deliveryAcceptanceState !== "open"))}
                className="public-button-primary py-4"
              >
                {isOrderPending
                  ? stagingUiMode ? "Проверяем оформление…" : "Создаём платёж"
                  : stagingUiMode ? "Проверить оформление" : "Перейти к оплате"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => (
                <article key={line.lineId} className="rounded-lg border border-karimoff-line bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-karimoff-black">{line.product.name}</h3>
                      <p className="mt-1 font-heading text-sm font-black text-karimoff-orange-contrast">{formatPrice(getCartLineUnitPrice(line))} ₽</p>
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
                        className="h-11 w-11 text-lg font-bold transition hover:text-karimoff-orange-contrast"
                        aria-label="Уменьшить количество"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increment(line.lineId)}
                        className="h-11 w-11 text-lg font-bold transition hover:text-karimoff-orange-contrast"
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
          <div className="mb-4">
            {mode === "checkout" && deliveryType === "delivery" ? (
              <>
                <div className="mb-2 flex items-center justify-between text-sm font-semibold text-karimoff-muted">
                  <span>Доставка</span>
                  <span>{deliveryFee ? `${formatPrice(deliveryFee)} ₽` : "Бесплатно"}</span>
                </div>
                <p className="mb-3 text-xs font-medium text-karimoff-muted">Бесплатно при заказе от 2 500 ₽</p>
              </>
            ) : null}
            <div className="flex items-center justify-between text-lg font-black">
              <span>Итого</span>
              <span className="font-heading text-karimoff-orange-contrast">{formatPrice(mode === "checkout" ? checkoutTotal : totalPrice)} ₽</span>
            </div>
          </div>
          <div className="grid gap-3">
            {checkoutContextError && mode === "cart" ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-700">
                {checkoutContextError}
              </p>
            ) : null}
            {mode === "cart" ? (
              <button
                type="button"
                onClick={checkout}
                disabled={!lines.length || isCustomerLoading}
                aria-busy={isCustomerLoading}
                className="public-button-primary py-4"
              >
                {isCustomerLoading ? "Открываем оформление…" : "Оформить заказ"}
              </button>
            ) : null}
            {lines.length && mode !== "checkout" ? (
              <button
                type="button"
                onClick={clearCart}
                className="public-button-secondary"
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
