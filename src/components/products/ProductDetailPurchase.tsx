"use client";

import { Check, ChevronDown, Minus, Plus, ShoppingBasket } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getConfiguredCartUnitPrice,
  getDefaultCartCustomization,
  isCartCustomizationValid,
  useCart,
  type CartCustomization
} from "@/components/cart/CartProvider";
import type { Product, ProductCompositionItem, ProductModifierGroup } from "@/lib/product-types";
import { getPortionGroup, getReplacementControlledIngredientIds, getServingLabel } from "@/lib/product-serving";
import { getCustomizedNutrition } from "@/lib/product-nutrition";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function selectedCount(group: ProductModifierGroup, selected: Set<string>) {
  return group.options.filter((option) => selected.has(option.id)).length;
}

export function ProductDetailPurchase({ product, composition = [], nutritionIngredients = [] }: { product: Product; composition?: ProductCompositionItem[]; nutritionIngredients?: ProductCompositionItem[] }) {
  const { addItem } = useCart();
  const defaults = useMemo(() => getDefaultCartCustomization(product), [product]);
  const [removed, setRemoved] = useState(new Set(defaults.removed.map((item) => item.ingredient_id)));
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [selectedOptions, setSelectedOptions] = useState(new Set(defaults.modifierOptionIds));
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const ingredientOptions = product.modifier_options ?? [];
  const portion = getPortionGroup(product);
  const controlledIngredients = getReplacementControlledIngredientIds(product);
  const removable = ingredientOptions.filter((option) => option.is_removable && !controlledIngredients.has(option.ingredient_id));
  const addable = ingredientOptions.filter((option) => option.is_extra_available);
  const groups = (product.modifier_groups ?? []).filter(group => group.id !== portion?.id);
  const customization: CartCustomization = {
    removed: removable
      .filter((option) => removed.has(option.ingredient_id))
      .map((option) => ({ ingredient_id: option.ingredient_id, name: option.name })),
    extras: addable
      .map((option) => ({
        ingredient_id: option.ingredient_id,
        name: option.name,
        quantity: extras[option.ingredient_id] ?? 0,
        unit_price: option.extra_price
      }))
      .filter((extra) => extra.quantity > 0),
    modifierOptionIds: [...selectedOptions],
    note
  };
  const portionChosen = !portion || portion.options.some(option => selectedOptions.has(option.id));
  const valid = isCartCustomizationValid(product, customization) && portionChosen;
  const total = getConfiguredCartUnitPrice(product, customization) * quantity;
  const nutrition = getCustomizedNutrition(product, composition, nutritionIngredients, customization);

  function toggleGroupOption(group: ProductModifierGroup, optionId: string) {
    setSelectedOptions((current) => {
      const next = new Set(current);
      if (group.selection_type === "single") {
        const canClear = group.min_selections === 0 && next.has(optionId);
        group.options.forEach((option) => next.delete(option.id));
        if (!canClear) next.add(optionId);
        return next;
      }
      if (next.has(optionId)) next.delete(optionId);
      else if (selectedCount(group, next) < group.max_selections) next.add(optionId);
      return next;
    });
    setAdded(false);
  }

  function addToCart() {
    if (!valid) return;
    addItem(product, customization, quantity);
    setAdded(true);
  }

  return (
    <div className="mt-8 border-t border-karimoff-line pt-7">
      {portion ? <fieldset className="mb-7">
        <legend className="text-lg font-bold text-karimoff-black">Размер порции</legend>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {portion.options.map(option => <button type="button" key={option.id} aria-pressed={selectedOptions.has(option.id)}
            onClick={() => toggleGroupOption(portion, option.id)}
            className={`min-h-16 rounded-lg border p-3 text-left text-karimoff-black ${selectedOptions.has(option.id) ? "border-karimoff-orange bg-karimoff-orange/10" : "border-karimoff-line bg-white"}`}>
            <strong className="block text-base">{option.label}</strong>
            <span className="text-sm text-karimoff-orange">{formatPrice(product.price + option.price_delta)} ₽</span>
          </button>)}
        </div>
      </fieldset> : null}
      {removable.length ? (
        <fieldset>
          <legend className="text-lg font-black text-karimoff-black">Убрать из состава</legend>
          <p className="mt-1 text-sm leading-6 text-karimoff-muted">Удаление ингредиента не уменьшает цену.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {removable.map((option) => {
              const checked = removed.has(option.ingredient_id);
              return (
                <button
                  key={option.ingredient_id}
                  type="button"
                  onClick={() => {
                    setRemoved((current) => {
                      const next = new Set(current);
                      if (next.has(option.ingredient_id)) next.delete(option.ingredient_id);
                      else next.add(option.ingredient_id);
                      return next;
                    });
                    setExtras((current) => ({ ...current, [option.ingredient_id]: 0 }));
                    setAdded(false);
                  }}
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 text-left text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${checked ? "border-amber-500 bg-amber-50 text-amber-950" : "border-karimoff-line bg-white hover:border-karimoff-orange/60"}`}
                  aria-pressed={checked}
                >
                  <span>Без {option.name.toLocaleLowerCase("ru-RU")}</span>
                  {checked ? <Check size={17} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {addable.length ? (
        <fieldset className="mt-7">
          <legend className="text-lg font-black text-karimoff-black">Добавить</legend>
          <div className="mt-3 grid gap-2">
            {addable.map((option) => {
              const value = extras[option.ingredient_id] ?? 0;
              return (
                <div key={option.ingredient_id} className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-karimoff-line bg-white px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-karimoff-black">{option.name}</p>
                    <p className="mt-1 text-sm font-bold text-karimoff-orange">+{formatPrice(option.extra_price)} ₽</p>
                  </div>
                  <div className="grid shrink-0 grid-cols-[44px_36px_44px] items-center rounded-lg border border-karimoff-line">
                    <button
                      type="button"
                      onClick={() => {
                        setExtras((current) => ({ ...current, [option.ingredient_id]: Math.max(0, value - 1) }));
                        setAdded(false);
                      }}
                      className="grid h-11 place-items-center"
                      aria-label={`Уменьшить ${option.name}`}
                    >
                      <Minus size={18} />
                    </button>
                    <strong className="text-center tabular-nums">{value}</strong>
                    <button
                      type="button"
                      onClick={() => {
                        setRemoved((current) => {
                          const next = new Set(current);
                          next.delete(option.ingredient_id);
                          return next;
                        });
                        setExtras((current) => ({
                          ...current,
                          [option.ingredient_id]: Math.min(option.max_extra_quantity, value + 1)
                        }));
                        setAdded(false);
                      }}
                      className="grid h-11 place-items-center"
                      aria-label={`Добавить ${option.name}`}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {groups.map((group) => {
        const count = selectedCount(group, selectedOptions);
        const invalid = count < group.min_selections || count > group.max_selections;
        const optional = group.min_selections === 0;
        const fieldset = (
          <fieldset key={group.id} className={optional ? "mt-4" : "mt-7"}>
            <legend className={optional ? "sr-only" : "flex flex-wrap items-center gap-2 text-lg font-black text-karimoff-black"}>
              {group.name}
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${group.min_selections > 0 ? "bg-karimoff-orange/10 text-karimoff-orange" : "bg-karimoff-soft text-karimoff-muted"}`}>
                {group.min_selections > 0 ? "Обязательно" : "По желанию"}
              </span>
            </legend>
            <p className={`mt-1 text-sm ${invalid ? "font-bold text-red-700" : "text-karimoff-muted"}`}>
              {group.selection_type === "single" ? "Выберите один вариант" : `Можно выбрать до ${group.max_selections}`}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => {
                const checked = selectedOptions.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleGroupOption(group, option.id)}
                    className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${checked ? "border-karimoff-orange bg-karimoff-orange/5" : "border-karimoff-line bg-white hover:border-karimoff-orange/60"}`}
                    aria-pressed={checked}
                  >
                    <span>
                      <span className="block text-sm font-black text-karimoff-black">{option.label}</span>
                      {option.price_delta > 0 ? <span className="mt-1 block text-xs font-bold text-karimoff-orange">+{formatPrice(option.price_delta)} ₽</span> : null}
                    </span>
                    {checked ? <Check size={17} className="shrink-0 text-karimoff-orange" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
        return optional ? <details key={group.id} className="group/modifiers mt-7 border-y border-karimoff-line py-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-bold text-karimoff-black [&::-webkit-details-marker]:hidden">
            <span>{group.name}<span className="mt-1 block text-xs font-normal text-karimoff-muted">{count ? `Выбрано: ${count}` : "По желанию"}</span></span>
            <ChevronDown size={20} aria-hidden className="shrink-0 transition-transform group-open/modifiers:rotate-180" />
          </summary>
          {fieldset}
        </details> : fieldset;
      })}

      <label className="mt-7 block">
        <span className="text-lg font-black text-karimoff-black">Комментарий к блюду</span>
        <textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value.slice(0, 300));
            setAdded(false);
          }}
          rows={3}
          placeholder="Например: хорошо прожарить"
          className="mt-3 w-full resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 text-base leading-6 outline-none transition focus:border-karimoff-orange focus:ring-4 focus:ring-karimoff-orange/10"
        />
      </label>

      <div className="mt-7 flex flex-col gap-4 border-t border-karimoff-line pt-6 sm:flex-row sm:items-center">
        <div className="grid w-fit grid-cols-[48px_56px_48px] items-center rounded-lg border border-karimoff-line bg-white p-1">
          <button type="button" onClick={() => { setQuantity((value) => Math.max(1, value - 1)); setAdded(false); }} className="grid h-12 place-items-center rounded-md hover:bg-karimoff-soft" aria-label="Уменьшить количество"><Minus size={20} /></button>
          <strong className="text-center text-xl tabular-nums">{quantity}</strong>
          <button type="button" onClick={() => { setQuantity((value) => Math.min(20, value + 1)); setAdded(false); }} className="grid h-12 place-items-center rounded-md hover:bg-karimoff-soft" aria-label="Увеличить количество"><Plus size={20} /></button>
        </div>
        <button
          type="button"
          onClick={addToCart}
          disabled={!valid}
          className={`public-button-primary min-h-14 flex-1 gap-3 text-base ${added ? "public-button-success" : ""}`}
          aria-live="polite"
        >
          {added ? <Check size={21} aria-hidden /> : <ShoppingBasket size={21} aria-hidden />}
          <span>{!portionChosen ? "Выберите порцию" : `${added ? "Добавлено" : "Добавить в корзину"} · ${formatPrice(total)} ₽`}</span>
        </button>
      </div>
      {!valid ? <p className="mt-3 text-sm text-karimoff-muted">{!portionChosen ? "Выберите размер порции выше." : "Выберите обязательные варианты блюда."}</p> : null}
      <section className="mt-8 border-t border-karimoff-line pt-6" aria-label="Пищевая ценность выбранного блюда">
        <h2 className="text-xl font-bold text-karimoff-black">КБЖУ на порцию</h2>
        {portion ? (
          <p className="mt-2 text-sm text-karimoff-muted">
            {portionChosen ? getServingLabel(product, [...selectedOptions]) : "Выберите размер порции"}
          </p>
        ) : null}
        {portionChosen && nutrition.complete ? <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {nutrition.items.map(item => <div key={item.key} className="min-w-0">
              <dt className="text-xs text-karimoff-muted">{item.label}</dt>
              <dd className="mt-1 text-base font-bold tabular-nums text-karimoff-black">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: item.key === "calories" ? 0 : 1 }).format(item.value ?? 0)} {item.unit}</dd>
            </div>)}
          </dl>
          <p className="mt-3 text-xs text-karimoff-muted">Расчёт по составу выбранной порции. Значения ориентировочные.</p>
        </> : <p className="mt-3 text-sm text-karimoff-muted">{portionChosen ? "Данные уточняются." : "Пищевая ценность появится после выбора порции."}</p>}
      </section>
    </div>
  );
}
