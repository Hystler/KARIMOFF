"use client";

import { Minus, Plus, ShoppingBasket, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useCart, type CartCustomization } from "@/components/cart/CartProvider";
import type { Product } from "@/lib/product-types";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function ProductCustomizer({ product }: { product: Product }) {
  const { addItem } = useCart();
  const [isOpen, setIsOpen] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<Record<string, number>>({});
  const options = useMemo(() => product.modifier_options ?? [], [product.modifier_options]);
  const hasOptions = options.some((option) => option.is_removable || option.is_extra_available);
  const extraTotal = useMemo(
    () =>
      options.reduce(
        (sum, option) => sum + (extras[option.ingredient_id] ?? 0) * option.extra_price,
        0
      ),
    [extras, options]
  );

  function addConfiguredProduct() {
    const customization: CartCustomization = {
      removed: options
        .filter((option) => removed.has(option.ingredient_id))
        .map((option) => ({ ingredient_id: option.ingredient_id, name: option.name })),
      extras: options
        .filter((option) => (extras[option.ingredient_id] ?? 0) > 0)
        .map((option) => ({
          ingredient_id: option.ingredient_id,
          name: option.name,
          quantity: extras[option.ingredient_id],
          unit_price: option.extra_price
        }))
    };

    addItem(product, customization);
    setIsOpen(false);
  }

  if (!hasOptions) {
    return (
      <button type="button" onClick={() => addItem(product)} className="product-cta">
        <ShoppingBasket aria-hidden size={18} strokeWidth={2.4} />
        <span>В корзину</span>
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className="product-cta">
        <SlidersHorizontal aria-hidden size={18} strokeWidth={2.4} />
        <span>Выбрать состав</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Закрыть настройку состава"
            className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
            onClick={() => setIsOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`customizer-${product.id}`}
            className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-white/10 bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-lg sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-karimoff-orange">Соберите под себя</p>
                <h2 id={`customizer-${product.id}`} className="mt-2 text-2xl font-black leading-tight text-karimoff-black">
                  {product.name}
                </h2>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">
                  Убранные ингредиенты не уменьшают цену. Добавки оплачиваются отдельно.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-karimoff-line text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-6">
              {options.some((option) => option.is_removable) ? (
                <fieldset>
                  <legend className="text-sm font-black text-karimoff-black">Убрать из блюда</legend>
                  <div className="mt-3 grid gap-2">
                    {options.filter((option) => option.is_removable).map((option) => (
                      <label key={option.ingredient_id} className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-karimoff-line px-4 py-3">
                        <span className="text-sm font-semibold text-karimoff-black">Без {option.name.toLowerCase()}</span>
                        <input
                          type="checkbox"
                          checked={removed.has(option.ingredient_id)}
                          onChange={(event) => {
                            setRemoved((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(option.ingredient_id);
                              else next.delete(option.ingredient_id);
                              return next;
                            });
                          }}
                          className="h-5 w-5 accent-karimoff-orange"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {options.some((option) => option.is_extra_available) ? (
                <fieldset>
                  <legend className="text-sm font-black text-karimoff-black">Добавить</legend>
                  <div className="mt-3 grid gap-2">
                    {options.filter((option) => option.is_extra_available).map((option) => {
                      const value = extras[option.ingredient_id] ?? 0;
                      return (
                        <div key={option.ingredient_id} className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-karimoff-line px-4 py-3">
                          <div>
                            <p className="text-sm font-bold text-karimoff-black">{option.name}</p>
                            <p className="mt-1 text-xs font-semibold text-karimoff-orange">+{formatPrice(option.extra_price)} ₽</p>
                          </div>
                          <div className="inline-flex items-center rounded-full border border-karimoff-line bg-karimoff-cream">
                            <button
                              type="button"
                              onClick={() => setExtras((current) => ({ ...current, [option.ingredient_id]: Math.max(0, value - 1) }))}
                              className="flex h-10 w-10 items-center justify-center"
                              aria-label={`Уменьшить ${option.name}`}
                            >
                              <Minus size={16} />
                            </button>
                            <span className="min-w-7 text-center text-sm font-black">{value}</span>
                            <button
                              type="button"
                              onClick={() => setExtras((current) => ({ ...current, [option.ingredient_id]: Math.min(option.max_extra_quantity, value + 1) }))}
                              className="flex h-10 w-10 items-center justify-center"
                              aria-label={`Добавить ${option.name}`}
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </div>

            <button type="button" onClick={addConfiguredProduct} className="product-cta mt-7 min-h-14 text-base">
              <ShoppingBasket aria-hidden size={20} strokeWidth={2.4} />
              <span>Добавить за {formatPrice(product.price + extraTotal)} ₽</span>
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
