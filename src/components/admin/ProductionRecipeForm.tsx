"use client";

import { CircleDollarSign, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Ingredient } from "@/lib/ingredients";
import {
  calculateProductionMetrics,
  getCostPerOutputUnit,
  productionUnitFamily,
  type ProductionUnit
} from "@/lib/production-calculations";
import type { ProductionRecipeView } from "@/lib/production";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";

type ComponentDraft = {
  ingredient_id: string;
  is_primary: boolean;
  quantity: number;
  sort_order: number;
  unit: ProductionUnit;
};

type ExpenseDraft = {
  amount_per_batch: number;
  category: "labor" | "electricity" | "packaging" | "supplies" | "logistics" | "other";
  name: string;
  sort_order: number;
};

type ProductionRecipeFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  ingredients: Ingredient[];
  monthlyOverhead: number;
  recipe?: ProductionRecipeView | null;
  totalPlannedMinutes: number;
};

const unitLabels: Record<ProductionUnit, string> = {
  g: "г",
  kg: "кг",
  l: "л",
  ml: "мл",
  pcs: "шт."
};

const expenseCategories = [
  { label: "Труд", value: "labor" },
  { label: "Электричество", value: "electricity" },
  { label: "Упаковка", value: "packaging" },
  { label: "Расходники", value: "supplies" },
  { label: "Логистика", value: "logistics" },
  { label: "Другое", value: "other" }
] as const;

function defaultUnit(ingredient?: Ingredient): ProductionUnit {
  if (ingredient?.unit === "g") return "kg";
  if (ingredient?.unit === "ml") return "l";
  return "pcs";
}

function allowedUnits(ingredient?: Ingredient): ProductionUnit[] {
  if (ingredient?.unit === "g") return ["kg", "g"];
  if (ingredient?.unit === "ml") return ["l", "ml"];
  return ["pcs"];
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ProductionRecipeForm({
  action,
  ingredients,
  monthlyOverhead,
  recipe,
  totalPlannedMinutes
}: ProductionRecipeFormProps) {
  const firstIngredient = ingredients[0];
  const [outputIngredientId, setOutputIngredientId] = useState(recipe?.output_ingredient_id ?? firstIngredient?.id ?? "");
  const initialOutputIngredient = ingredients.find((ingredient) => ingredient.id === outputIngredientId);
  const [outputQuantity, setOutputQuantity] = useState(recipe?.output_quantity ?? 1);
  const [outputUnit, setOutputUnit] = useState<ProductionUnit>(recipe?.output_unit ?? defaultUnit(initialOutputIngredient));
  const [duration, setDuration] = useState(recipe?.batch_duration_minutes ?? 60);
  const [plannedBatches, setPlannedBatches] = useState(recipe?.planned_batches_per_month ?? 0);
  const [salePrice, setSalePrice] = useState(recipe?.sale_price_per_output_unit ?? 0);
  const [components, setComponents] = useState<ComponentDraft[]>(
    recipe?.components.length
      ? recipe.components.map((component) => ({
          ingredient_id: component.ingredient_id,
          is_primary: component.is_primary,
          quantity: component.quantity,
          sort_order: component.sort_order,
          unit: component.unit
        }))
      : [{ ingredient_id: firstIngredient?.id ?? "", is_primary: true, quantity: 1, sort_order: 100, unit: defaultUnit(firstIngredient) }]
  );
  const [expenses, setExpenses] = useState<ExpenseDraft[]>(
    recipe?.direct_expenses.map((expense) => ({
      amount_per_batch: expense.amount_per_batch,
      category: expense.category,
      name: expense.name,
      sort_order: expense.sort_order
    })) ?? []
  );

  const outputIngredient = ingredients.find((ingredient) => ingredient.id === outputIngredientId);
  const calculatedTotalMinutes = Math.max(
    0,
    totalPlannedMinutes - (recipe?.batch_duration_minutes ?? 0) * (recipe?.planned_batches_per_month ?? 0)
  ) + duration * plannedBatches;
  const metrics = useMemo(() => calculateProductionMetrics({
    batchDurationMinutes: duration,
    components: components.map((component) => ({
      costPerBaseUnit: ingredients.find((ingredient) => ingredient.id === component.ingredient_id)?.cost_per_unit ?? 0,
      isPrimary: component.is_primary,
      quantity: component.quantity,
      unit: component.unit
    })),
    directExpenses: expenses.map((expense) => ({ amountPerBatch: expense.amount_per_batch })),
    monthlyOverhead,
    outputQuantity,
    outputUnit,
    plannedBatchesPerMonth: plannedBatches,
    salePricePerOutputUnit: salePrice,
    totalPlannedMinutes: calculatedTotalMinutes
  }), [calculatedTotalMinutes, components, duration, expenses, ingredients, monthlyOverhead, outputQuantity, outputUnit, plannedBatches, salePrice]);

  function selectOutputIngredient(id: string) {
    const ingredient = ingredients.find((item) => item.id === id);
    setOutputIngredientId(id);
    setOutputUnit(defaultUnit(ingredient));
  }

  function addComponent() {
    const used = new Set(components.map((component) => component.ingredient_id));
    const ingredient = ingredients.find((item) => !used.has(item.id)) ?? ingredients[0];
    setComponents((current) => [...current, {
      ingredient_id: ingredient?.id ?? "",
      is_primary: false,
      quantity: 1,
      sort_order: (current.length + 1) * 100,
      unit: defaultUnit(ingredient)
    }]);
  }

  return (
    <form action={action} className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      {recipe ? <input type="hidden" name="id" value={recipe.id} /> : null}
      <input type="hidden" name="components_json" value={JSON.stringify(components)} />
      <input type="hidden" name="expenses_json" value={JSON.stringify(expenses)} />

      <div className="grid gap-6">
        <section className="admin-card p-5 sm:p-6">
          <p className="admin-eyebrow">Основное</p>
          <h2 className="mt-2 text-xl font-black">Партия и выход</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="admin-field sm:col-span-2">
              Название карты
              <input name="name" required defaultValue={recipe?.name ?? ""} placeholder="Например: Курица жареная" />
            </label>
            <label className="admin-field">
              Выходной полуфабрикат
              <select name="output_ingredient_id" required value={outputIngredientId} onChange={(event) => selectOutputIngredient(event.target.value)}>
                {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
              </select>
            </label>
            <label className="admin-field">
              Категория
              <input name="category" defaultValue={recipe?.category ?? ""} placeholder="Мясо / соусы / заготовки" />
            </label>
            <label className="admin-field">
              Выход одной партии
              <input name="output_quantity" type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(numericValue(event.target.value))} />
            </label>
            <label className="admin-field">
              Единица выпуска
              <select name="output_unit" value={outputUnit} onChange={(event) => setOutputUnit(event.target.value as ProductionUnit)}>
                {allowedUnits(outputIngredient).map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
              </select>
            </label>
            <label className="admin-field">
              Длительность партии, мин.
              <input name="batch_duration_minutes" type="number" min="1" step="1" value={duration} onChange={(event) => setDuration(numericValue(event.target.value))} />
            </label>
            <label className="admin-field">
              План партий в месяц
              <input name="planned_batches_per_month" type="number" min="0" step="0.1" value={plannedBatches} onChange={(event) => setPlannedBatches(numericValue(event.target.value))} />
            </label>
            <label className="admin-field">
              Цена продажи за {unitLabels[outputUnit]}
              <input name="sale_price_per_output_unit" type="number" min="0" step="0.01" value={salePrice} onChange={(event) => setSalePrice(numericValue(event.target.value))} />
            </label>
            <label className="admin-field">
              Порядок
              <input name="sort_order" type="number" min="0" step="1" defaultValue={recipe?.sort_order ?? 100} />
            </label>
            <label className="admin-field sm:col-span-2">
              Комментарий
              <textarea name="notes" rows={3} defaultValue={recipe?.notes ?? ""} placeholder="Температура, фасовка, важные примечания" />
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-karimoff-line px-4 text-sm font-bold sm:col-span-2">
              <input name="is_active" type="checkbox" defaultChecked={recipe?.is_active ?? true} className="h-5 w-5 accent-karimoff-orange" />
              Карта активна и участвует в плане
            </label>
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-karimoff-line p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
            <div>
              <p className="admin-eyebrow">Сырьё</p>
              <h2 className="mt-2 text-xl font-black">Состав партии</h2>
              <p className="mt-2 text-sm leading-6 text-karimoff-muted">Указывайте закупаемое количество до ужарки. Основное сырьё нужно для расчёта выхода и потерь.</p>
            </div>
            <button type="button" onClick={addComponent} className="admin-secondary-button shrink-0"><Plus size={17} />Добавить сырьё</button>
          </div>
          <div className="grid gap-3 p-5 sm:p-6">
            {components.map((component, index) => {
              const ingredient = ingredients.find((item) => item.id === component.ingredient_id);
              const lineCost = (ingredient?.cost_per_unit ?? 0) * (component.unit === "kg" || component.unit === "l" ? component.quantity * 1000 : component.quantity);
              return (
                <div key={`${component.ingredient_id}-${index}`} className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-cream/45 p-4 lg:grid-cols-[minmax(220px,1fr)_130px_105px_130px_44px] lg:items-end">
                  <label className="admin-field">
                    Ингредиент
                    <select value={component.ingredient_id} onChange={(event) => {
                      const nextIngredient = ingredients.find((item) => item.id === event.target.value);
                      setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ingredient_id: event.target.value, unit: defaultUnit(nextIngredient) } : item));
                    }}>
                      <option value="">Выберите</option>
                      {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className="admin-field">
                    Количество
                    <input type="number" min="0.001" step="0.001" value={component.quantity} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: numericValue(event.target.value) } : item))} />
                  </label>
                  <label className="admin-field">
                    Единица
                    <select value={component.unit} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value as ProductionUnit } : item))}>
                      {allowedUnits(ingredient).map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
                    </select>
                  </label>
                  <div>
                    <p className="text-xs font-black text-karimoff-muted">Стоимость</p>
                    <p className="mt-3 font-black tabular-nums">{formatRub(lineCost, 2)}</p>
                    <label className="mt-2 flex items-center gap-2 text-xs font-bold text-karimoff-muted">
                      <input type="radio" name="primary_component" checked={component.is_primary} onChange={() => setComponents((current) => current.map((item, itemIndex) => ({ ...item, is_primary: itemIndex === index })))} className="accent-karimoff-orange" />
                      Основное
                    </label>
                  </div>
                  <button type="button" aria-label="Удалить сырьё" onClick={() => setComponents((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"><Trash2 size={17} /></button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-karimoff-line p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
            <div>
              <p className="admin-eyebrow">На партию</p>
              <h2 className="mt-2 text-xl font-black">Прямые расходы</h2>
              <p className="mt-2 text-sm leading-6 text-karimoff-muted">Труд смены, электричество, упаковка и расходники именно для этой партии.</p>
            </div>
            <button type="button" onClick={() => setExpenses((current) => [...current, { amount_per_batch: 0, category: "other", name: "", sort_order: (current.length + 1) * 100 }])} className="admin-secondary-button shrink-0"><Plus size={17} />Добавить расход</button>
          </div>
          <div className="grid gap-3 p-5 sm:p-6">
            {expenses.length ? expenses.map((expense, index) => (
              <div key={`${expense.name}-${index}`} className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-cream/45 p-4 md:grid-cols-[180px_minmax(180px,1fr)_150px_44px] md:items-end">
                <label className="admin-field">Тип<select value={expense.category} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as ExpenseDraft["category"] } : item))}>{expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                <label className="admin-field">Статья<input value={expense.name} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Например: работа смены" /></label>
                <label className="admin-field">₽ на партию<input type="number" min="0" step="0.01" value={expense.amount_per_batch} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount_per_batch: numericValue(event.target.value) } : item))} /></label>
                <button type="button" aria-label="Удалить расход" onClick={() => setExpenses((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"><Trash2 size={17} /></button>
              </div>
            )) : <p className="admin-empty">Прямых расходов пока нет. Сырьё всё равно попадёт в расчёт.</p>}
          </div>
        </section>

        <button type="submit" className="admin-primary-button w-full sm:w-fit">{recipe ? "Сохранить карту" : "Создать карту"}</button>
      </div>

      <aside className="admin-card p-5 xl:sticky xl:top-7">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-karimoff-orange/10 text-karimoff-orange"><CircleDollarSign size={22} /></div>
        <p className="admin-eyebrow mt-5">Расчёт</p>
        <h2 className="mt-2 text-xl font-black">Одна партия</h2>
        <dl className="mt-5 grid gap-3 text-sm">
          <Result label="Сырьё" value={formatRub(metrics.materialCost, 2)} />
          <Result label="Прямые расходы" value={formatRub(metrics.directCost, 2)} />
          <Result label="Доля месячных расходов" value={formatRub(metrics.overheadPerBatch, 2)} />
          <Result label="Полная себестоимость" value={formatRub(metrics.totalCost, 2)} strong />
          <Result label={`Себестоимость за ${unitLabels[outputUnit]}`} value={formatRub(getCostPerOutputUnit(metrics.costPerBaseUnit, outputUnit), 2)} />
          {productionUnitFamily(outputUnit) !== "pieces" ? <Result label={`Себестоимость за 100 ${outputUnit === "kg" || outputUnit === "g" ? "г" : "мл"}`} value={formatRub(metrics.costPer100BaseUnits, 2)} /> : null}
          <Result label="Выручка партии" value={formatRub(metrics.plannedRevenue, 2)} />
          <Result label="Валовая прибыль" value={formatRub(metrics.grossProfit, 2)} strong />
          <Result label="Маржа" value={formatPercent(metrics.grossMarginPercent)} />
          <Result label="Выход основного сырья" value={metrics.yieldPercent === null ? "Отметьте основное сырьё" : formatPercent(metrics.yieldPercent)} />
          <Result label="Потери / ужарка" value={metrics.lossPercent === null ? "—" : formatPercent(metrics.lossPercent)} />
        </dl>
        <div className="mt-5 rounded-lg bg-karimoff-black p-4 text-white">
          <p className="text-xs font-bold text-white/60">План на месяц</p>
          <p className="mt-2 text-xl font-black">{formatRub(metrics.plannedMonthlyGrossProfit, 2)}</p>
          <p className="mt-1 text-xs text-white/60">расчётная валовая прибыль при {formatNumber(plannedBatches, 1)} партиях</p>
        </div>
      </aside>
    </form>
  );
}

function Result({ label, value, strong = false }: { label: string; strong?: boolean; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-karimoff-line pb-3 last:border-b-0"><dt className="text-karimoff-muted">{label}</dt><dd className={strong ? "text-right font-black tabular-nums" : "text-right font-bold tabular-nums"}>{value}</dd></div>;
}
