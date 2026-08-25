"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Minus,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultPosCustomization,
  getPosLineUnitPrice,
  type PosCartCustomization,
  type PosCartLine
} from "@/lib/order-flow/pos-cart";
import type { Product, ProductModifierGroup } from "@/lib/product-types";

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function productImage(product: Product) {
  return product.image_url || "/assets/products/placeholder-burger.svg";
}

function selectedCount(group: ProductModifierGroup, selected: Set<string>) {
  return group.options.filter((option) => selected.has(option.id)).length;
}

export function PosProductCustomizer({
  product,
  line,
  onClose,
  onSave
}: {
  product: Product | null;
  line: PosCartLine | null;
  onClose: () => void;
  onSave: (value: { customization: PosCartCustomization; quantity: number }) => void;
}) {
  const initial = line?.customization ?? (product ? defaultPosCustomization(product) : null);
  const [removed, setRemoved] = useState(() => new Set(initial?.removedIngredientIds ?? []));
  const [extras, setExtras] = useState<Record<string, number>>(() =>
    Object.fromEntries((initial?.extras ?? []).map((extra) => [extra.ingredientId, extra.quantity]))
  );
  const [selectedOptions, setSelectedOptions] = useState(() => new Set(initial?.modifierOptionIds ?? []));
  const [note, setNote] = useState(initial?.note ?? "");
  const [quantity, setQuantity] = useState(line?.quantity ?? 1);

  useEffect(() => {
    if (!product) return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, product]);

  const ingredientOptions = product?.modifier_options ?? [];
  const removable = ingredientOptions.filter((option) => option.is_removable);
  const addable = ingredientOptions.filter((option) => option.is_extra_available);
  const groups = product?.modifier_groups ?? [];
  const groupsValid = groups.every((group) => {
    const count = selectedCount(group, selectedOptions);
    return count >= group.min_selections && count <= group.max_selections;
  });
  const draftLine = useMemo<PosCartLine | null>(() => product ? ({
    lineId: line?.lineId ?? "preview",
    product,
    quantity,
    customization: {
      removedIngredientIds: [...removed],
      extras: addable
        .map((option) => ({
          ingredientId: option.ingredient_id,
          quantity: extras[option.ingredient_id] ?? 0
        }))
        .filter((extra) => extra.quantity > 0),
      modifierOptionIds: [...selectedOptions],
      note
    }
  }) : null, [addable, extras, line?.lineId, note, product, quantity, removed, selectedOptions]);
  const unitPrice = draftLine ? getPosLineUnitPrice(draftLine) : 0;

  function toggleGroupOption(group: ProductModifierGroup, optionId: string) {
    setSelectedOptions((current) => {
      const next = new Set(current);
      if (group.selection_type === "single") {
        const canClearSelection = group.min_selections === 0 && next.has(optionId);
        for (const option of group.options) next.delete(option.id);
        if (!canClearSelection) next.add(optionId);
        return next;
      }
      if (next.has(optionId)) next.delete(optionId);
      else if (selectedCount(group, next) < group.max_selections) next.add(optionId);
      return next;
    });
  }

  function save() {
    if (!draftLine || !groupsValid) return;
    onSave({ customization: draftLine.customization, quantity });
  }

  return (
    <AnimatePresence>
      {product ? (
        <motion.div
          className="fixed inset-0 z-[80] flex justify-end bg-black/45 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-customizer-title"
        >
          <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Закрыть настройку блюда" />
          <motion.aside
            className="relative z-10 flex h-full w-full max-w-[620px] flex-col overflow-hidden bg-[#F5F3EF] shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-black/10 bg-white p-4 sm:p-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-black uppercase text-[#C94F05]"><SlidersHorizontal size={15} /> {line ? "Изменить позицию" : "Настроить блюдо"}</p>
                <h2 id="pos-customizer-title" className="mt-2 text-2xl font-black leading-tight sm:text-3xl">{product.name}</h2>
                <p className="mt-2 text-sm font-bold text-black/50">Базовая цена {formatRub(product.price)} ₽</p>
              </div>
              <button type="button" onClick={onClose} className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-black/10 bg-white transition hover:border-[#FB670A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FB670A]/20" aria-label="Закрыть">
                <X size={22} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
                <div className="aspect-[4/3] overflow-hidden rounded-lg border border-black/10 bg-[#FCF7F0] p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={productImage(product)} alt={product.name} className="h-full w-full object-contain" />
                </div>
                <div>
                  <p className="text-sm font-black text-black/60">Количество</p>
                  <div className="mt-3 inline-grid grid-cols-[52px_72px_52px] items-center rounded-lg border border-black/10 bg-white p-1">
                    <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="grid h-12 place-items-center rounded-md hover:bg-black/5" aria-label="Уменьшить количество"><Minus size={20} /></button>
                    <strong className="text-center text-xl tabular-nums">{quantity}</strong>
                    <button type="button" onClick={() => setQuantity((value) => Math.min(20, value + 1))} className="grid h-12 place-items-center rounded-md hover:bg-black/5" aria-label="Увеличить количество"><Plus size={20} /></button>
                  </div>
                </div>
              </div>

              {removable.length ? (
                <fieldset className="mt-7">
                  <legend className="text-lg font-black">Убрать</legend>
                  <p className="mt-1 text-sm leading-5 text-black/50">Удаление ингредиента не уменьшает цену.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {removable.map((option) => {
                      const checked = removed.has(option.ingredient_id);
                      return (
                        <button
                          key={option.ingredient_id}
                          type="button"
                          onClick={() => setRemoved((current) => {
                            const next = new Set(current);
                            if (next.has(option.ingredient_id)) next.delete(option.ingredient_id);
                            else {
                              next.add(option.ingredient_id);
                              setExtras((currentExtras) => ({
                                ...currentExtras,
                                [option.ingredient_id]: 0
                              }));
                            }
                            return next;
                          })}
                          className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 text-left transition ${checked ? "border-amber-500 bg-amber-50 text-amber-950" : "border-black/10 bg-white hover:border-[#FB670A]/50"}`}
                          aria-pressed={checked}
                        >
                          <span className="font-black">Без {option.name.toLocaleLowerCase("ru-RU")}</span>
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${checked ? "border-amber-600 bg-amber-600 text-white" : "border-black/20"}`}>{checked ? <Check size={16} /> : null}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {addable.length ? (
                <fieldset className="mt-7">
                  <legend className="text-lg font-black">Добавить</legend>
                  <div className="mt-3 grid gap-2">
                    {addable.map((option) => {
                      const value = extras[option.ingredient_id] ?? 0;
                      return (
                        <div key={option.ingredient_id} className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-black/10 bg-white px-4 py-2">
                          <div className="min-w-0">
                            <p className="font-black">{option.name}</p>
                            <p className="mt-1 text-sm font-bold text-[#C94F05]">+{formatRub(option.extra_price)} ₽</p>
                          </div>
                          <div className="grid shrink-0 grid-cols-[44px_36px_44px] items-center rounded-lg border border-black/10">
                            <button type="button" onClick={() => setExtras((current) => ({ ...current, [option.ingredient_id]: Math.max(0, value - 1) }))} className="grid h-11 place-items-center" aria-label={`Уменьшить ${option.name}`}><Minus size={18} /></button>
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
                              }}
                              className="grid h-11 place-items-center"
                              aria-label={`Добавить ${option.name}`}
                            ><Plus size={18} /></button>
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
                return (
                  <fieldset key={group.id} className="mt-7">
                    <legend className="flex flex-wrap items-center gap-2 text-lg font-black">
                      {group.name}
                      <span className={`rounded-full px-2.5 py-1 text-[11px] ${group.min_selections > 0 ? "bg-[#FB670A]/10 text-[#B84704]" : "bg-black/5 text-black/50"}`}>{group.min_selections > 0 ? "Обязательно" : "По желанию"}</span>
                    </legend>
                    <p className={`mt-1 text-sm ${invalid ? "font-bold text-red-700" : "text-black/50"}`}>
                      {group.selection_type === "single" ? "Выберите один вариант" : `Можно выбрать до ${group.max_selections}`}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {group.options.map((option) => {
                        const checked = selectedOptions.has(option.id);
                        return (
                          <button key={option.id} type="button" onClick={() => toggleGroupOption(group, option.id)} className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 text-left transition ${checked ? "border-[#FB670A] bg-[#FFF4EC]" : "border-black/10 bg-white hover:border-[#FB670A]/50"}`} aria-pressed={checked}>
                            <span>
                              <span className="block font-black">{option.label}</span>
                              {option.price_delta > 0 ? <span className="mt-1 block text-sm font-bold text-[#C94F05]">+{formatRub(option.price_delta)} ₽</span> : null}
                            </span>
                            <span className={`grid h-6 w-6 shrink-0 place-items-center ${group.selection_type === "single" ? "rounded-full" : "rounded-md"} border ${checked ? "border-[#FB670A] bg-[#FB670A] text-white" : "border-black/20"}`}>{checked ? <Check size={16} /> : null}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              <label className="mt-7 block">
                <span className="text-lg font-black">Комментарий к позиции</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} rows={3} placeholder="Например: хорошо прожарить" className="mt-3 w-full resize-none rounded-lg border border-black/10 bg-white px-4 py-3 text-base leading-6 outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10" />
                <span className="mt-1 block text-right text-xs text-black/35">{note.length}/300</span>
              </label>
            </div>

            <footer className="border-t border-black/10 bg-white p-4 sm:p-6">
              {!groupsValid ? <p className="mb-3 text-sm font-bold text-red-700">Заполните обязательные группы.</p> : null}
              <button type="button" onClick={save} disabled={!groupsValid} className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-lg bg-[#FB670A] px-5 text-base font-black text-white shadow-[0_14px_32px_rgba(251,103,10,0.25)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">
                <ShoppingBag size={21} />
                <span>{line ? "Обновить позицию" : "Добавить в заказ"} · {formatRub(unitPrice * quantity)} ₽</span>
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
