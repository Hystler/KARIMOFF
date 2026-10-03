"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { BrandWordmark } from "@/components/Logo";
import styles from "./PosWorkspace.module.css";
import {
  CheckCircle2,
  ChevronDown,
  ChefHat,
  CirclePlus,
  CreditCard,
  Minus,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  UserRound
} from "lucide-react";
import {
  createPosOrderAction
} from "@/app/pos/actions";
import { PosProductCustomizer } from "@/components/operations/PosProductCustomizer";
import { PosLoyaltyIdentifier, type PosLoyaltyCustomer } from "@/components/operations/PosLoyaltyIdentifier";
import { getProductImageUrl } from "@/lib/product-image-url";
import {
  initialPosOrderActionState,
  type PosOrderActionState
} from "@/lib/order-flow/pos-action-state";
import {
  addPosCartLine,
  canQuickAddProduct,
  defaultPosCustomization,
  getPosLineUnitPrice,
  serializePosCart,
  type PosCartCustomization,
  type PosCartLine
} from "@/lib/order-flow/pos-cart";
import type { OrderLocation } from "@/lib/order-flow/types";
import type { Product } from "@/lib/product-types";

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function productImage(product: Product) {
  return getProductImageUrl(product.image_url || "/assets/products/placeholder-burger.svg");
}

function isCustomizable(product: Product) {
  return Boolean(product.modifier_options?.some((option) => option.is_removable || option.is_extra_available)) ||
    Boolean(product.modifier_groups?.length);
}

function lineLabels(line: PosCartLine) {
  const ingredients = new Map(
    (line.product.modifier_options ?? []).map((option) => [option.ingredient_id, option.name])
  );
  const options = new Map(
    (line.product.modifier_groups ?? []).flatMap((group) =>
      group.options.map((option) => [option.id, option] as const)
    )
  );
  return [
    ...line.customization.removedIngredientIds.map((id) => `БЕЗ ${ingredients.get(id) ?? "ингредиента"}`),
    ...line.customization.extras.map((extra) =>
      `+ ${ingredients.get(extra.ingredientId) ?? "добавка"}${extra.quantity > 1 ? ` ×${extra.quantity}` : ""}`
    ),
    ...line.customization.modifierOptionIds
      .map((id) => options.get(id)?.label)
      .filter((label): label is string => Boolean(label))
  ];
}

type TerminalPaymentView = {
  intentId: string;
  orderId: string;
  displayNumber: string | null;
  status: "queued" | "processing" | "paid" | "failed" | "cancelled" | "unknown";
  amount: number;
  result: Record<string, unknown>;
};

export function PosWorkspace({
  products,
  locations,
  initialLocationId,
  initialIdempotencyKey,
  staffName,
  testMode,
  paymentsEnabled,
  initialPayment
}: {
  products: Product[];
  locations: OrderLocation[];
  initialLocationId: string;
  initialIdempotencyKey: string;
  staffName: string;
  testMode: boolean;
  paymentsEnabled: boolean;
  initialPayment: TerminalPaymentView | null;
}) {
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все");
  const [customerName, setCustomerName] = useState("Гость");
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<PosLoyaltyCustomer | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [payment, setPayment] = useState<TerminalPaymentView | null>(initialPayment);
  const [terminalMessage, setTerminalMessage] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [resolutionPending, setResolutionPending] = useState(false);
  const [customizer, setCustomizer] = useState<{ product: Product; line: PosCartLine | null } | null>(null);
  const finishTerminalPayment = useCallback((result: TerminalPaymentView) => {
    setPayment(null);
    setReceiptReference("");
    if (result.status === "paid") {
      setCart([]);
      setCustomerName("Гость");
      setLoyaltyCustomer(null);
      setIdempotencyKey(crypto.randomUUID());
      setTerminalMessage(`Оплата принята. Заказ ${result.displayNumber || "создан"} отправлен на кухню.`);
    } else {
      setIdempotencyKey(crypto.randomUUID());
      setTerminalMessage("Оплата не прошла, заказ не отправлен на кухню. Проверьте терминал и попробуйте ещё раз.");
    }
  }, []);

  const showTerminalPayment = useCallback((result: TerminalPaymentView) => {
    if (["paid", "failed", "cancelled"].includes(result.status)) finishTerminalPayment(result);
    else setPayment(result);
  }, [finishTerminalPayment]);

  const [state, formAction, pending] = useActionState(
    async (previous: PosOrderActionState, formData: FormData) => {
      const result = await createPosOrderAction(previous, formData);
      if (result.status === "success" && result.paymentIntentId) {
        setTerminalMessage("");
        setReceiptReference("");
        showTerminalPayment({
          intentId: result.paymentIntentId,
          orderId: result.orderId || "",
          displayNumber: result.displayNumber || null,
          status: result.paymentStatus || "queued",
          amount: result.amount || 0,
          result: {}
        });
      }
      return result;
    },
    initialPosOrderActionState
  );
  const paymentIntentId = payment?.intentId;
  useEffect(() => {
    if (!paymentIntentId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/pos/payments/${paymentIntentId}/status`, { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as {
          status?: TerminalPaymentView["status"];
          orderId?: string;
          displayNumber?: string | null;
          amount?: number;
          result?: Record<string, unknown>;
        };
        if (stopped || !result.status) return;
        const updated: TerminalPaymentView = {
          intentId: paymentIntentId,
          orderId: result.orderId || "",
          displayNumber: result.displayNumber || null,
          status: result.status,
          amount: Number(result.amount || 0),
          result: result.result || {}
        };
        if (["paid", "failed", "cancelled"].includes(updated.status)) finishTerminalPayment(updated);
        else setPayment(updated);
      } catch {
        // The next poll retries; the server keeps the order hidden until a final terminal result.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [finishTerminalPayment, paymentIntentId]);

  async function resolveUnknownPayment(resolution: "paid" | "cancelled") {
    if (!payment || payment.status !== "unknown" || resolutionPending) return;
    if (resolution === "paid" && !receiptReference.trim()) {
      setTerminalMessage("Укажите номер или идентификатор выданного фискального чека.");
      return;
    }
    setResolutionPending(true);
    try {
      const response = await fetch(`/api/pos/payments/${payment.intentId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, receiptReference: receiptReference.trim() || undefined })
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setTerminalMessage(result.error || "Не удалось подтвердить состояние оплаты.");
        return;
      }
      setPayment({ ...payment, status: resolution });
      setTerminalMessage("");
    } catch {
      setTerminalMessage("Не удалось связаться с сервером. Проверьте сеть и повторите.");
    } finally {
      setResolutionPending(false);
    }
  }
  const categories = useMemo(
    () => ["Все", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))],
    [products]
  );
  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return products.filter((product) => (
      (category === "Все" || product.category === category) &&
      (!normalized || product.name.toLocaleLowerCase("ru-RU").includes(normalized))
    ));
  }, [category, products, query]);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + getPosLineUnitPrice(line) * line.quantity, 0);

  function quickAdd(product: Product) {
    if (!canQuickAddProduct(product)) {
      setCustomizer({ product, line: null });
      return;
    }
    setCart((current) => addPosCartLine(current, product, defaultPosCustomization(product), 1));
  }

  function changeQuantity(lineId: string, delta: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.lineId !== lineId) return [line];
      const quantity = Math.max(0, Math.min(20, line.quantity + delta));
      return quantity ? [{ ...line, quantity }] : [];
    }));
  }

  function saveCustomization(value: { customization: PosCartCustomization; quantity: number }) {
    if (!customizer) return;
    setCart((current) => {
      if (!customizer.line) {
        return addPosCartLine(current, customizer.product, value.customization, value.quantity);
      }
      const remaining = current.filter((line) => line.lineId !== customizer.line?.lineId);
      return addPosCartLine(
        remaining,
        customizer.product,
        value.customization,
        value.quantity,
        customizer.line.lineId
      );
    });
    setCustomizer(null);
  }

  return (
    <main className={`${styles.workspace} min-h-dvh bg-[#F4F5F6] text-[#121214]`}>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#121214] text-white shadow-lg">
        <div className="mx-auto flex min-h-14 max-w-[1800px] items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#FB670A]">
              <ShoppingBag size={23} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="flex items-center gap-2 truncate text-lg font-black leading-tight"><BrandWordmark inverse size="sm" /><span>POS</span></p>
                {testMode ? <span className="rounded-md bg-sky-400/15 px-2 py-1 text-[10px] font-black uppercase text-sky-300">Test</span> : null}
              </div>
              <p className="truncate text-xs text-white/55">{staffName} · касса</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2"><a href="/admin" className="inline-flex min-h-9 items-center rounded-md border border-white/15 px-3 text-sm font-bold">Обзор</a><a href="/kitchen" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm font-bold transition hover:border-[#FB670A] hover:text-[#FF9A5C]">
            <ChefHat size={19} />
            <span className="hidden sm:inline">Открыть кухню</span>
          </a></div>
        </div>
      </header>

      {testMode ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-center text-sm font-bold text-sky-900">
          <TestTube2 className="mr-2 inline" size={17} />
          Тестовый режим: заказы видны кухне, но не списывают склад и не попадают в выручку. Оплата и печать фискального чека не выполняются.
        </div>
      ) : null}

      <div className={`${styles.layout} mx-auto grid max-w-[1800px] gap-0`}>
        <section className="min-w-0 px-4 py-4 lg:border-r lg:border-black/10">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-xl font-black leading-tight">Новый заказ</h1>
            </div>
            <label className="flex min-h-10 min-w-0 items-center gap-3 rounded-md border border-black/10 bg-white px-3 xl:w-[280px]">
              <Search size={19} className="shrink-0 text-black/40" aria-hidden="true" />
              <span className="sr-only">Поиск по меню</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти позицию" className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-black/35" />
            </label>
          </div>

          <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-2" aria-label="Категории меню">
            {categories.map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`min-h-9 shrink-0 rounded-md px-3 text-sm font-bold transition ${category === item ? "bg-[#121214] text-white" : "border border-black/10 bg-white text-black/60 hover:border-[#FB670A] hover:text-[#C94F05]"}`}>
                {item}
              </button>
            ))}
          </div>

          {visibleProducts.length ? (
            <div className={styles.catalog}>
              {visibleProducts.map((product) => {
                const quantity = cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0);
                const customizable = isCustomizable(product);
                return (
                  <article key={product.id} className={`${styles.catalogCard} group flex min-w-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white transition hover:border-[#FB670A]/60`}>
                    <button type="button" onClick={() => setCustomizer({ product, line: null })} className={`${styles.catalogMedia} relative aspect-[4/3] w-full overflow-hidden bg-[#F7F8F9] text-left active:scale-[0.99]`} aria-label={`Настроить ${product.name}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={productImage(product) ?? undefined} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      {quantity ? <span className="absolute right-2 top-2 grid h-9 min-w-9 place-items-center rounded-full bg-[#FB670A] px-2 text-sm font-black text-[#121214] shadow-lg">{quantity}</span> : null}
                    </button>
                    <div className={`${styles.catalogBody} flex flex-1 flex-col p-2.5`}>
                      <button type="button" onClick={() => setCustomizer({ product, line: null })} className="text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FB670A]/15">
                        <h2 className="min-h-10 text-sm font-bold leading-5">{product.name}</h2>
                        <p className="mt-1 text-base font-black tabular-nums text-[#D95405]">{formatRub(product.price)} ₽</p>
                      </button>
                      <div className={`mt-auto grid gap-2 pt-2 ${customizable ? "grid-cols-[minmax(0,1fr)_36px]" : "grid-cols-1"}`}>
                        <button type="button" onClick={() => quickAdd(product)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[#FB670A] px-2 text-xs font-bold text-[#121214] active:scale-[0.98]">
                          <CirclePlus size={19} /> Добавить
                        </button>
                        {customizable ? <button type="button" onClick={() => setCustomizer({ product, line: null })} className="grid min-h-9 place-items-center rounded-md border border-black/10" aria-label={`Настроить ${product.name}`} title="Настроить"><SlidersHorizontal size={17} /></button> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className="mt-5 rounded-lg border border-dashed border-black/15 bg-white p-10 text-center text-sm text-black/55">По этому запросу ничего не найдено.</div>}
        </section>

        <aside className="min-w-0 bg-white">
          <form key={state.resetKey ?? "initial"} action={formAction} className={`${styles.checkout} flex flex-col p-4`}>
            <input type="hidden" name="idempotency_key" value={idempotencyKey} />
            <input type="hidden" name="items" value={JSON.stringify(serializePosCart(cart))} />
            <input type="hidden" name="customer_id" value={loyaltyCustomer?.id ?? ""} />
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-bold text-[#C94F05]">Текущий заказ</p><h2 className="mt-1 text-lg font-black">{itemCount ? `${itemCount} поз.` : "Пусто"}</h2></div>
              {itemCount ? <button type="button" onClick={() => setCart([])} className="grid h-11 w-11 place-items-center rounded-lg border border-red-200 text-red-600" aria-label="Очистить заказ"><Trash2 size={19} /></button> : null}
            </div>

            <div className="mt-3 space-y-2">
              {cart.length ? cart.map((line) => {
                const labels = lineLabels(line);
                return (
                  <article key={line.lineId} className="rounded-lg border border-black/10 bg-[#FAF9F7] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => setCustomizer({ product: line.product, line })} className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-black leading-5">{line.product.name}</span>
                        <span className="mt-1 block text-xs font-bold text-black/45">{formatRub(getPosLineUnitPrice(line))} ₽ × {line.quantity}</span>
                      </button>
                      <button type="button" onClick={() => setCustomizer({ product: line.product, line })} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-black/10 bg-white" aria-label="Изменить позицию"><Pencil size={17} /></button>
                    </div>
                    {labels.length ? <div className="mt-2 flex flex-wrap gap-1.5">{labels.map((label) => <span key={label} className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-black uppercase text-amber-900">{label}</span>)}</div> : null}
                    {line.customization.note ? <p className="mt-2 text-xs font-bold leading-5 text-black/60">Комментарий: {line.customization.note}</p> : null}
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/5 pt-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => changeQuantity(line.lineId, -1)} className="grid h-10 w-10 place-items-center rounded-lg border border-black/10 bg-white" aria-label="Уменьшить количество"><Minus size={17} /></button>
                        <span className="w-8 text-center text-sm font-black tabular-nums">{line.quantity}</span>
                        <button type="button" onClick={() => changeQuantity(line.lineId, 1)} className="grid h-10 w-10 place-items-center rounded-lg border border-black/10 bg-white" aria-label="Увеличить количество"><Plus size={17} /></button>
                      </div>
                      <strong className="text-base tabular-nums">{formatRub(getPosLineUnitPrice(line) * line.quantity)} ₽</strong>
                    </div>
                  </article>
                );
              }) : <div className="grid min-h-[160px] place-items-center rounded-lg border border-dashed border-black/15 bg-[#F8F7F4] p-6 text-center"><div><ShoppingBag className="mx-auto text-black/25" size={30} /><p className="mt-3 text-sm font-bold text-black/45">Добавьте позиции из меню</p></div></div>}
            </div>

            <div className="mt-3 space-y-2 border-t border-black/10 pt-3">
              <PosLoyaltyIdentifier
                customer={loyaltyCustomer}
                onChange={(next) => {
                  setLoyaltyCustomer(next);
                  setCustomerName(next?.name ?? "Гость");
                }}
              />
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-black text-black/60"><UserRound size={15} /> Имя для выдачи</span>
                <input name="customer_name" value={customerName} onChange={(event) => setCustomerName(event.target.value.slice(0, 40))} onFocus={(event) => { if (event.currentTarget.value === "Гость") event.currentTarget.select(); }} maxLength={40} autoComplete="off" inputMode="text" className="min-h-12 w-full rounded-lg border border-black/10 px-4 text-base font-bold outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10" />
              </label>
              <details className="group rounded-lg border border-black/10 bg-[#FAF9F7] px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-black text-black/60">Комментарий ко всему заказу<ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
                <textarea name="comment" maxLength={500} rows={2} placeholder="Пожелание гостя" className="mt-2 w-full resize-none rounded-lg border border-black/10 bg-white px-4 py-3 text-base outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10" />
              </details>
              {locations.length > 1 ? <label className="block"><span className="mb-1.5 block text-xs font-black text-black/60">Точка</span><select name="location_id" defaultValue={initialLocationId} className="min-h-12 w-full rounded-lg border border-black/10 bg-white px-4 text-base font-bold outline-none focus:border-[#FB670A]">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : <input type="hidden" name="location_id" value={initialLocationId} />}
              <div className="flex items-center justify-between text-lg font-black"><span>Итого</span><span className="text-2xl tabular-nums text-[#D95405]">{formatRub(total)} ₽</span></div>
              {terminalMessage || state.status !== "idle" ? <div role="status" aria-live="polite" className={`rounded-lg px-4 py-3 text-sm font-bold ${state.status === "error" || terminalMessage.startsWith("Оплата не прошла") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{state.status === "success" && !terminalMessage ? <CheckCircle2 className="mr-2 inline" size={18} /> : null}{terminalMessage || state.message}</div> : null}
              <button type="submit" disabled={!itemCount || pending || Boolean(payment) || testMode || !paymentsEnabled} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#FB670A] px-5 text-base font-black text-[#121214] shadow-[0_14px_32px_rgba(251,103,10,0.28)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"><CreditCard size={21} />{pending ? "Отправляем на терминал…" : testMode ? "Оплата отключена в тестовом режиме" : !paymentsEnabled ? "Оплата через терминал пока отключена" : "Перейти к оплате"}</button>
            </div>
          </form>
        </aside>
      </div>

      {payment ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="terminal-payment-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <p className="text-xs font-black uppercase tracking-wide text-[#C94F05]">Оплата через Эвотор</p>
            <h2 id="terminal-payment-title" className="mt-2 text-2xl font-black">
              {payment.status === "unknown" ? "Проверьте терминал" : payment.status === "queued" ? "Отправляем заказ на кассу" : "Ожидаем оплату"}
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-black/65">
              Заказ {payment.displayNumber || "создан"} · {formatRub(payment.amount)} ₽.
              {payment.status === "queued" ? " Приложение KARIMOFF Bridge должно быть открыто на терминале." : null}
              {payment.status === "processing" ? " Заказ уже виден кухне. Приготовление станет доступно после успешной оплаты и чека." : null}
              {payment.status === "unknown" ? " Результат оплаты не подтвердился. Не запускайте оплату повторно, пока не проверите состояние кассы." : null}
            </p>
            {payment.status === "unknown" ? (
              <div className="mt-5 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-bold leading-5 text-amber-950">{String(payment.result.details || "Проверьте, прошла ли оплата и выдан ли фискальный чек.")}</p>
                <label className="block text-sm font-bold text-black/70">
                  Номер/ID чека, если терминал подтверждает оплату
                  <input value={receiptReference} onChange={(event) => setReceiptReference(event.target.value.slice(0, 128))} maxLength={128} className="mt-2 min-h-12 w-full rounded-lg border border-black/15 bg-white px-3 text-base font-semibold outline-none focus:border-[#FB670A]" />
                </label>
                <button type="button" disabled={resolutionPending || !receiptReference.trim()} onClick={() => void resolveUnknownPayment("paid")} className="min-h-12 w-full rounded-lg bg-emerald-700 px-3 text-sm font-black text-white disabled:opacity-40">Подтвердить оплату и чек</button>
                <button type="button" disabled={resolutionPending} onClick={() => void resolveUnknownPayment("cancelled")} className="min-h-12 w-full rounded-lg border border-red-300 bg-white px-3 text-sm font-black text-red-700 disabled:opacity-40">Подтвердить, что оплата точно не прошла</button>
                {terminalMessage ? <p role="status" className="text-sm font-bold text-red-700">{terminalMessage}</p> : null}
                <p className="text-xs font-semibold leading-5 text-amber-900">Подтверждайте оплату только после проверки успешной операции и фискального чека на терминале. При подтверждённом отказе заказ останется вне кухни, а корзину можно будет отправить повторно.</p>
              </div>
            ) : (
              <div className="mt-5 flex items-center gap-3 rounded-xl bg-[#F5F5F5] p-4 text-sm font-bold text-black/60">
                <span className="h-3 w-3 animate-pulse rounded-full bg-[#FB670A]" />
                Корзина заблокирована до ответа терминала.
              </div>
            )}
          </section>
        </div>
      ) : null}

      <PosProductCustomizer key={`${customizer?.product.id ?? "none"}:${customizer?.line?.lineId ?? "new"}`} product={customizer?.product ?? null} line={customizer?.line ?? null} onClose={() => setCustomizer(null)} onSave={saveCustomization} />
    </main>
  );
}
