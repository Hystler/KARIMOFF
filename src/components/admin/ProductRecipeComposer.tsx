"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Ingredient } from "@/lib/ingredients";
import { calculateRecipeNutrition } from "@/lib/product-nutrition";

type DraftLine = {
  clientId: string;
  ingredientId: string;
  quantity: string;
  unit: "g" | "ml" | "pcs";
  sortOrder: number;
  station: "" | "grill" | "fryer" | "assembly" | "drinks" | "packing";
};

const unitLabels = { g: "г", ml: "мл", pcs: "шт." } as const;
const stationOptions = [
  ["", "Не указана"],
  ["grill", "Гриль"],
  ["fryer", "Фритюр"],
  ["assembly", "Сборка"],
  ["drinks", "Напитки"],
  ["packing", "Упаковка"]
] as const;

function emptyLine(clientId: string, sortOrder: number): DraftLine {
  return {
    clientId,
    ingredientId: "",
    quantity: "",
    unit: "g",
    sortOrder,
    station: ""
  };
}

function formatMetric(value: number | null, unit: string) {
  if (value === null) return "Данные уточняются";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function ProductRecipeComposer({ ingredients }: { ingredients: Ingredient[] }) {
  const activeIngredients = useMemo(
    () => ingredients.filter((ingredient) => ingredient.is_active),
    [ingredients]
  );
  const ingredientsById = useMemo(
    () => new Map(activeIngredients.map((ingredient) => [ingredient.id, ingredient])),
    [activeIngredients]
  );
  const nextId = useRef(2);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine("recipe-1", 10)]);

  const serializedLines = useMemo(() => lines.map((line, index) => ({
    ingredient_id: line.ingredientId,
    quantity: line.quantity,
    unit: line.unit,
    sort_order: (index + 1) * 10,
    station: line.station
  })), [lines]);

  const nutrition = useMemo(() => {
    if (lines.some((line) => !line.ingredientId || Number(line.quantity) <= 0)) {
      return calculateRecipeNutrition([]);
    }
    return calculateRecipeNutrition(lines.flatMap((line, index) => {
      const ingredient = ingredientsById.get(line.ingredientId);
      const quantity = Number(line.quantity);
      if (!ingredient || !Number.isFinite(quantity) || quantity <= 0) return [];
      return [{
        ingredient_id: ingredient.id,
        name: ingredient.name,
        sort_order: (index + 1) * 10,
        quantity,
        unit: ingredient.unit,
        nutrition_basis_quantity: ingredient.nutrition_basis_quantity,
        calories_kcal: ingredient.calories_kcal,
        proteins_g: ingredient.proteins_g,
        fats_g: ingredient.fats_g,
        carbohydrates_g: ingredient.carbohydrates_g
      }];
    }));
  }, [ingredientsById, lines]);

  const foodCost = useMemo(() => {
    if (lines.some((line) => !line.ingredientId || Number(line.quantity) <= 0)) return null;
    const total = lines.reduce((sum, line) => {
      const ingredient = ingredientsById.get(line.ingredientId);
      if (!ingredient || ingredient.cost_per_unit <= 0) return Number.NaN;
      const yieldRatio = 1 - ingredient.waste_percent / 100;
      return sum + (Number(line.quantity) / yieldRatio) * ingredient.cost_per_unit;
    }, 0);
    return Number.isFinite(total) ? total : null;
  }, [ingredientsById, lines]);

  function updateLine(clientId: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.clientId === clientId ? { ...line, ...patch } : line));
  }

  function selectIngredient(clientId: string, ingredientId: string) {
    const ingredient = ingredientsById.get(ingredientId);
    updateLine(clientId, { ingredientId, unit: ingredient?.unit ?? "g" });
  }

  function addLine() {
    const id = nextId.current++;
    setLines((current) => [...current, emptyLine(`recipe-${id}`, (current.length + 1) * 10)]);
  }

  function removeLine(clientId: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.clientId !== clientId));
  }

  return (
    <fieldset className="grid gap-4 rounded-lg border border-karimoff-line bg-karimoff-cream/50 p-4 sm:p-5">
      <legend className="px-2 text-sm font-bold text-karimoff-black">Состав, себестоимость и КБЖУ</legend>
      <input type="hidden" name="composition_json" value={JSON.stringify(serializedLines)} />

      <div>
        <h2 className="text-lg font-black text-karimoff-black">Соберите рецептуру до создания товара</h2>
        <p className="mt-1 text-xs font-medium leading-5 text-karimoff-muted">
          Товар и все строки состава сохраняются вместе. Если рецептура некорректна, пустой товар не появится.
        </p>
      </div>

      <div className="grid gap-3">
        {lines.map((line, index) => (
          <div key={line.clientId} className="grid gap-3 border-b border-karimoff-line pb-4 last:border-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_120px_72px_150px_44px] md:items-end">
            <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
              Ингредиент
              <select
                required
                value={line.ingredientId}
                onChange={(event) => selectIngredient(line.clientId, event.target.value)}
                className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange"
              >
                <option value="">Выберите</option>
                {activeIngredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
              Количество
              <input
                required
                type="number"
                min="0.001"
                step="0.001"
                value={line.quantity}
                onChange={(event) => updateLine(line.clientId, { quantity: event.target.value })}
                className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange"
              />
            </label>
            <div className="grid gap-2 text-xs font-bold text-karimoff-muted">
              Ед.
              <span className="grid min-h-11 place-items-center rounded-lg border border-karimoff-line bg-white text-sm text-karimoff-black">
                {unitLabels[line.unit]}
              </span>
            </div>
            <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
              Станция
              <select
                value={line.station}
                onChange={(event) => updateLine(line.clientId, { station: event.target.value as DraftLine["station"] })}
                className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange"
              >
                {stationOptions.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => removeLine(line.clientId)}
              disabled={lines.length === 1}
              aria-label={`Удалить строку ${index + 1}`}
              title="Удалить ингредиент"
              className="grid h-11 w-11 place-items-center rounded-full border border-red-200 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addLine}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-karimoff-black/15 bg-white px-4 py-2 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
      >
        <Plus size={18} />
        Добавить ингредиент
      </button>

      <div className="grid gap-3 rounded-lg border border-karimoff-line bg-white p-4 sm:grid-cols-5">
        <div>
          <span className="text-xs font-semibold text-karimoff-muted">Food cost</span>
          <strong className="mt-1 block text-base font-black text-karimoff-orange">
            {foodCost === null ? "Данные уточняются" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(foodCost)} ₽`}
          </strong>
        </div>
        {nutrition.items.map((item) => (
          <div key={item.key}>
            <span className="text-xs font-semibold text-karimoff-muted">{item.label}</span>
            <strong className="mt-1 block text-base font-black text-karimoff-black">{formatMetric(item.value, item.unit)}</strong>
          </div>
        ))}
      </div>
      {!nutrition.available && nutrition.missingIngredients.length ? (
        <p className="text-xs font-semibold leading-5 text-amber-700">
          Для автоматического КБЖУ заполните данные ингредиентов: {nutrition.missingIngredients.join(", ")}.
        </p>
      ) : null}
    </fieldset>
  );
}
