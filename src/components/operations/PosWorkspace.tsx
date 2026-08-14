"use client";

import { useActionState, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChefHat,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UserRound
} from "lucide-react";
import {
  createPosOrderAction,
  initialPosOrderActionState,
  type PosOrderActionState
} from "@/app/pos/actions";
import type { Product } from "@/lib/product-types";
import type { OrderLocation } from "@/lib/order-flow/types";

type CartLine = { product: Product; quantity: number };

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function productImage(product: Product) {
  return product.image_url || "/assets/products/placeholder-burger.svg";
}

export function PosWorkspace({
  products,
  locations,
  initialLocationId,
  initialIdempotencyKey,
  staffName
}: {
  products: Product[];
  locations: OrderLocation[];
  initialLocationId: string;
  initialIdempotencyKey: string;
  staffName: string;
}) {
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все");
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [state, formAction, pending] = useActionState(
    async (previous: PosOrderActionState, formData: FormData) => {
      const result = await createPosOrderAction(previous, formData);
      if (result.status === "success") {
        setCart(new Map());
        setIdempotencyKey(crypto.randomUUID());
      }
      return result;
    },
    initialPosOrderActionState
  );
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
  const lines = Array.from(cart.values());
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  const changeQuantity = (product: Product, delta: number) => {
    setCart((current) => {
      const next = new Map(current);
      const quantity = Math.max(0, Math.min(20, (next.get(product.id)?.quantity ?? 0) + delta));
      if (!quantity) next.delete(product.id);
      else next.set(product.id, { product, quantity });
      return next;
    });
  };

  return (
    <main className="min-h-dvh bg-[#F3F1ED] text-[#121214]">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-[#121214] text-white shadow-lg">
        <div className="mx-auto flex min-h-[72px] max-w-[1800px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#FB670A]">
              <ShoppingBag size={23} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-black leading-tight">KARIMOFF POS</p>
              <p className="truncate text-xs text-white/55">{staffName} · быстрый заказ</p>
            </div>
          </div>
          <a href="/kitchen" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-bold transition hover:border-[#FB670A] hover:text-[#FF9A5C]">
            <ChefHat size={19} />
            <span className="hidden sm:inline">Открыть кухню</span>
          </a>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1800px] gap-0 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 px-4 py-5 sm:px-6 sm:py-6 xl:border-r xl:border-black/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">Новый заказ</h1>
              <p className="mt-1 text-sm text-black/55">Коснитесь позиции, чтобы добавить её в заказ.</p>
            </div>
            <label className="flex min-h-12 min-w-0 items-center gap-3 rounded-lg border border-black/10 bg-white px-4 shadow-sm lg:w-[340px]">
              <Search size={19} className="shrink-0 text-black/40" aria-hidden="true" />
              <span className="sr-only">Поиск по меню</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти позицию"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-black/35"
              />
            </label>
          </div>

          <div className="mt-5 flex max-w-full gap-2 overflow-x-auto pb-2 scrollbar-hide" aria-label="Категории меню">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`min-h-11 shrink-0 rounded-lg px-4 text-sm font-black transition ${
                  category === item
                    ? "bg-[#121214] text-white shadow-md"
                    : "border border-black/10 bg-white text-black/60 hover:border-[#FB670A] hover:text-[#C94F05]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {visibleProducts.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
              {visibleProducts.map((product) => {
                const quantity = cart.get(product.id)?.quantity ?? 0;
                return (
                  <article key={product.id} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:border-[#FB670A]/60 hover:shadow-lg">
                    <button
                      type="button"
                      onClick={() => changeQuantity(product, 1)}
                      className="relative aspect-[4/3] w-full overflow-hidden bg-[#F8F2EA] p-3 text-left active:scale-[0.99]"
                      aria-label={`Добавить ${product.name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={productImage(product)} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" />
                      {quantity ? (
                        <span className="absolute right-2 top-2 grid h-9 min-w-9 place-items-center rounded-full bg-[#FB670A] px-2 text-sm font-black text-white shadow-lg">
                          {quantity}
                        </span>
                      ) : null}
                    </button>
                    <div className="flex flex-1 flex-col p-3 sm:p-4">
                      <h2 className="line-clamp-2 min-h-10 text-sm font-black leading-5 sm:text-base">{product.name}</h2>
                      <p className="mt-2 text-lg font-black tabular-nums text-[#D95405]">{formatRub(product.price)} ₽</p>
                      <div className="mt-3 grid grid-cols-[48px_1fr_48px] gap-2">
                        <button type="button" onClick={() => changeQuantity(product, -1)} disabled={!quantity} className="grid min-h-12 place-items-center rounded-lg border border-black/10 disabled:opacity-25" aria-label={`Убрать ${product.name}`}>
                          <Minus size={20} />
                        </button>
                        <button type="button" onClick={() => changeQuantity(product, 1)} className="min-h-12 rounded-lg bg-[#FB670A] px-2 text-sm font-black text-white shadow-sm active:scale-[0.98]">
                          Добавить
                        </button>
                        <button type="button" onClick={() => changeQuantity(product, 1)} className="grid min-h-12 place-items-center rounded-lg border border-black/10" aria-label={`Добавить ещё ${product.name}`}>
                          <Plus size={20} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-black/15 bg-white p-10 text-center text-sm text-black/55">
              По этому запросу ничего не найдено.
            </div>
          )}
        </section>

        <aside className="bg-white xl:min-h-[calc(100dvh-72px)]">
          <form key={state.resetKey ?? "initial"} action={formAction} className="flex h-full flex-col p-4 sm:p-6 xl:sticky xl:top-[72px] xl:max-h-[calc(100dvh-72px)]">
            <input type="hidden" name="idempotency_key" value={idempotencyKey} />
            <input type="hidden" name="items" value={JSON.stringify(lines.map((line) => ({ product_id: line.product.id, quantity: line.quantity })))} />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-[#C94F05]">Текущий заказ</p>
                <h2 className="mt-1 text-2xl font-black">{itemCount ? `${itemCount} поз.` : "Пусто"}</h2>
              </div>
              {itemCount ? (
                <button type="button" onClick={() => setCart(new Map())} className="grid h-11 w-11 place-items-center rounded-lg border border-red-200 text-red-600" aria-label="Очистить заказ">
                  <Trash2 size={19} />
                </button>
              ) : null}
            </div>

            <div className="mt-4 min-h-[112px] flex-1 space-y-2 overflow-y-auto overscroll-contain xl:pr-1">
              {lines.length ? lines.map((line) => (
                <div key={line.product.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-black/10 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-black leading-5">{line.product.name}</p>
                    <p className="mt-1 text-xs text-black/45">{formatRub(line.product.price)} ₽ × {line.quantity}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => changeQuantity(line.product, -1)} className="grid h-10 w-10 place-items-center rounded-lg border border-black/10" aria-label="Уменьшить количество"><Minus size={17} /></button>
                    <span className="w-7 text-center text-sm font-black tabular-nums">{line.quantity}</span>
                    <button type="button" onClick={() => changeQuantity(line.product, 1)} className="grid h-10 w-10 place-items-center rounded-lg border border-black/10" aria-label="Увеличить количество"><Plus size={17} /></button>
                  </div>
                </div>
              )) : (
                <div className="grid min-h-[160px] place-items-center rounded-lg border border-dashed border-black/15 bg-[#F8F7F4] p-6 text-center">
                  <div>
                    <ShoppingBag className="mx-auto text-black/25" size={30} />
                    <p className="mt-3 text-sm font-bold text-black/45">Добавьте позиции из меню</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3 border-t border-black/10 pt-4">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-black text-black/60"><UserRound size={15} /> Имя для выдачи</span>
                <input name="customer_name" maxLength={40} placeholder="Гость" autoComplete="off" className="min-h-12 w-full rounded-lg border border-black/10 px-4 text-base font-bold outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-black/60">Комментарий</span>
                <textarea name="comment" maxLength={500} rows={2} placeholder="Пожелание гостя" className="w-full resize-none rounded-lg border border-black/10 px-4 py-3 text-base outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-black/60">Точка</span>
                <select name="location_id" defaultValue={initialLocationId} className="min-h-12 w-full rounded-lg border border-black/10 bg-white px-4 text-base font-bold outline-none focus:border-[#FB670A]">
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <div className="flex items-center justify-between text-lg font-black">
                <span>Итого</span>
                <span className="text-2xl tabular-nums text-[#D95405]">{formatRub(total)} ₽</span>
              </div>
              {state.status !== "idle" ? (
                <div role="status" aria-live="polite" className={`rounded-lg px-4 py-3 text-sm font-bold ${state.status === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                  {state.status === "success" ? <CheckCircle2 className="mr-2 inline" size={18} /> : null}
                  {state.message}
                </div>
              ) : null}
              <button type="submit" disabled={!itemCount || pending} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#FB670A] px-5 text-base font-black text-white shadow-[0_14px_32px_rgba(251,103,10,0.28)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">
                <ChefHat size={21} />
                {pending ? "Отправляем…" : "Отправить на кухню"}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}
