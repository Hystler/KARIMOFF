"use client";

import { Check, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { type CartCustomization, type CartLine, useCart } from "./CartProvider";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function CartLineCustomizer({ line }: { line: CartLine }) {
  const { updateCustomization } = useCart();
  const [isOpen, setIsOpen] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(
    new Set(line.customization.removed.map((item) => item.ingredient_id))
  );
  const [extras, setExtras] = useState<Record<string, number>>(
    Object.fromEntries(line.customization.extras.map((item) => [item.ingredient_id, item.quantity]))
  );
  const [selectedOptions, setSelectedOptions] = useState(
    new Set(line.customization.modifierOptionIds)
  );
  const [note, setNote] = useState(line.customization.note);
  const options = useMemo(() => line.product.modifier_options ?? [], [line.product.modifier_options]);
  const removableOptions = options.filter((option) => option.is_removable);
  const extraOptions = options.filter((option) => option.is_extra_available);
  const groups = line.product.modifier_groups ?? [];
  const groupsValid = groups.every((group) => {
    const count = group.options.filter((option) => selectedOptions.has(option.id)).length;
    return count >= group.min_selections && count <= group.max_selections;
  });
  const hasOptions = removableOptions.length > 0 || extraOptions.length > 0 || groups.length > 0 || Boolean(note);

  if (!hasOptions) return null;

  function saveCustomization() {
    const customization: CartCustomization = {
      removed: removableOptions
        .filter((option) => removed.has(option.ingredient_id))
        .map((option) => ({ ingredient_id: option.ingredient_id, name: option.name })),
      extras: extraOptions
        .filter((option) => (extras[option.ingredient_id] ?? 0) > 0)
        .map((option) => ({
          ingredient_id: option.ingredient_id,
          name: option.name,
          quantity: extras[option.ingredient_id],
          unit_price: option.extra_price
        })),
      modifierOptionIds: [...selectedOptions],
      note
    };

    updateCustomization(line.lineId, customization);
    setIsOpen(false);
  }

  function toggleGroupOption(groupId: string, optionId: string) {
    const group = groups.find((item) => item.id === groupId);
    if (!group) return;
    setSelectedOptions((current) => {
      const next = new Set(current);
      if (group.selection_type === "single") {
        const canClear = group.min_selections === 0 && next.has(optionId);
        group.options.forEach((option) => next.delete(option.id));
        if (!canClear) next.add(optionId);
        return next;
      }
      if (next.has(optionId)) next.delete(optionId);
      else {
        const count = group.options.filter((option) => next.has(option.id)).length;
        if (count < group.max_selections) next.add(optionId);
      }
      return next;
    });
  }

  return (
    <div className="mt-3 border-t border-karimoff-line pt-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-karimoff-line bg-karimoff-cream px-4 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange"
        aria-expanded={isOpen}
      >
        <SlidersHorizontal size={16} strokeWidth={2.4} />
        Изменить состав
      </button>

      {isOpen ? (
        <div className="mt-3 grid gap-4 rounded-lg border border-karimoff-orange/20 bg-karimoff-cream p-3 sm:p-4">
          <p className="text-xs leading-5 text-karimoff-muted">
            Убранные ингредиенты не уменьшают цену. Добавки оплачиваются отдельно.
          </p>

          {removableOptions.length ? (
            <fieldset>
              <legend className="text-xs font-black uppercase text-karimoff-black">Убрать</legend>
              <div className="mt-2 grid gap-2">
                {removableOptions.map((option) => (
                  <label
                    key={option.ingredient_id}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-karimoff-line bg-white px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-karimoff-black">
                      Без {option.name.toLowerCase()}
                    </span>
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

          {extraOptions.length ? (
            <fieldset>
              <legend className="text-xs font-black uppercase text-karimoff-black">Добавить</legend>
              <div className="mt-2 grid gap-2">
                {extraOptions.map((option) => {
                  const value = extras[option.ingredient_id] ?? 0;
                  return (
                    <div
                      key={option.ingredient_id}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-karimoff-line bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-karimoff-black">{option.name}</p>
                        <p className="text-xs font-semibold text-karimoff-orange">
                          +{formatPrice(option.extra_price)} ₽
                        </p>
                      </div>
                      <div className="inline-flex shrink-0 items-center rounded-full border border-karimoff-line">
                        <button
                          type="button"
                          onClick={() =>
                            setExtras((current) => ({
                              ...current,
                              [option.ingredient_id]: Math.max(0, value - 1)
                            }))
                          }
                          className="flex h-9 w-9 items-center justify-center"
                          aria-label={`Уменьшить ${option.name}`}
                        >
                          <Minus size={15} />
                        </button>
                        <span className="min-w-6 text-center text-sm font-black">{value}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setExtras((current) => ({
                              ...current,
                              [option.ingredient_id]: Math.min(option.max_extra_quantity, value + 1)
                            }))
                          }
                          className="flex h-9 w-9 items-center justify-center"
                          aria-label={`Добавить ${option.name}`}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {groups.map((group) => {
            const count = group.options.filter((option) => selectedOptions.has(option.id)).length;
            const invalid = count < group.min_selections || count > group.max_selections;
            return (
              <fieldset key={group.id}>
                <legend className="flex items-center gap-2 text-xs font-black uppercase text-karimoff-black">
                  {group.name}
                  {group.min_selections > 0 ? (
                    <span className="rounded-full bg-karimoff-orange/10 px-2 py-1 text-[10px] text-karimoff-orange">
                      Обязательно
                    </span>
                  ) : null}
                </legend>
                <p className={`mt-2 text-xs ${invalid ? "font-bold text-red-700" : "text-karimoff-muted"}`}>
                  {group.selection_type === "single" ? "Выберите один вариант" : `Можно выбрать до ${group.max_selections}`}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.options.map((option) => {
                    const checked = selectedOptions.has(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggleGroupOption(group.id, option.id)}
                        className={`flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${checked ? "border-karimoff-orange bg-karimoff-orange/5" : "border-karimoff-line bg-white hover:border-karimoff-orange/60"}`}
                        aria-pressed={checked}
                      >
                        <span>
                          {option.label}
                          {option.price_delta > 0 ? (
                            <span className="ml-1 font-bold text-karimoff-orange">+{formatPrice(option.price_delta)} ₽</span>
                          ) : null}
                        </span>
                        {checked ? <Check size={16} className="shrink-0 text-karimoff-orange" /> : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <label className="grid gap-2 text-xs font-black uppercase text-karimoff-black">
            Комментарий к позиции
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 300))}
              rows={2}
              placeholder="Например: хорошо прожарить"
              className="resize-none rounded-md border border-karimoff-line bg-white px-3 py-2 text-sm font-normal normal-case leading-5 outline-none focus:border-karimoff-orange"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveCustomization}
              disabled={!groupsValid}
              className="min-h-11 flex-1 rounded-full bg-karimoff-orange px-4 text-sm font-black text-white transition hover:bg-[#D95405] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="min-h-11 rounded-full border border-karimoff-line bg-white px-4 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
