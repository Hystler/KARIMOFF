"use client";

import { Plus, Save, Trash2 } from "lucide-react";
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
import styles from "./OperationsWorkspace.module.css";

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
    <form action={action} className={styles.recipeForm}>
      {recipe ? <input type="hidden" name="id" value={recipe.id} /> : null}
      <input type="hidden" name="components_json" value={JSON.stringify(components)} />
      <input type="hidden" name="expenses_json" value={JSON.stringify(expenses)} />

      <div className={styles.recipeBody}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><h2>Партия и выход</h2></div>
          <div className={`${styles.formGrid} ${styles.recipeFields}`}>
            <label className={`${styles.field} ${styles.spanTwo}`}>
              Название карты
              <input name="name" required defaultValue={recipe?.name ?? ""} placeholder="Например: Курица жареная" />
            </label>
            <label className={styles.field}>
              Выходной полуфабрикат
              <select name="output_ingredient_id" required value={outputIngredientId} onChange={(event) => selectOutputIngredient(event.target.value)}>
                {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Категория
              <input name="category" defaultValue={recipe?.category ?? ""} placeholder="Мясо / соусы / заготовки" />
            </label>
            <label className={styles.field}>
              Выход одной партии
              <input name="output_quantity" type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(numericValue(event.target.value))} />
            </label>
            <label className={styles.field}>
              Единица выпуска
              <select name="output_unit" value={outputUnit} onChange={(event) => setOutputUnit(event.target.value as ProductionUnit)}>
                {allowedUnits(outputIngredient).map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Длительность партии, мин.
              <input name="batch_duration_minutes" type="number" min="1" step="1" value={duration} onChange={(event) => setDuration(numericValue(event.target.value))} />
            </label>
            <label className={styles.field}>
              План партий в месяц
              <input name="planned_batches_per_month" type="number" min="0" step="0.1" value={plannedBatches} onChange={(event) => setPlannedBatches(numericValue(event.target.value))} />
            </label>
            <label className={styles.field}>
              Цена продажи за {unitLabels[outputUnit]}
              <input name="sale_price_per_output_unit" type="number" min="0" step="0.01" value={salePrice} onChange={(event) => setSalePrice(numericValue(event.target.value))} />
            </label>
            <label className={styles.field}>
              Порядок
              <input name="sort_order" type="number" min="0" step="1" defaultValue={recipe?.sort_order ?? 100} />
            </label>
            <label className={`${styles.field} ${styles.spanTwo}`}>
              Комментарий
              <textarea name="notes" rows={2} defaultValue={recipe?.notes ?? ""} placeholder="Температура, фасовка, важные примечания" />
            </label>
            <label className={`${styles.check} ${styles.spanTwo}`}>
              <input name="is_active" type="checkbox" defaultChecked={recipe?.is_active ?? true} />
              Карта активна и участвует в плане
            </label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="recipe-components-heading">
          <div className={styles.sectionHeading}>
            <h2 id="recipe-components-heading">Состав партии</h2>
            <button type="button" onClick={addComponent} className={styles.button}><Plus size={15} />Добавить сырьё</button>
          </div>
          <div className={styles.tableScroll} role="region" aria-label="Состав партии" tabIndex={0}>
            <table className={`${styles.table} ${styles.lineItems}`}>
              <thead><tr><th scope="col">Ингредиент</th><th scope="col">Кол-во до обработки</th><th scope="col">Ед.</th><th scope="col">Основное</th><th scope="col" className={styles.numeric}>Стоимость</th><th scope="col"><span className="sr-only">Действия</span></th></tr></thead>
              <tbody>{components.map((component, index) => {
                const ingredient = ingredients.find((item) => item.id === component.ingredient_id);
                const lineCost = (ingredient?.cost_per_unit ?? 0) * (component.unit === "kg" || component.unit === "l" ? component.quantity * 1000 : component.quantity);
                return (
                  <tr key={index}>
                    <td><label className={styles.field}>
                      <span className="sr-only">Ингредиент {index + 1}</span>
                      <select value={component.ingredient_id} onChange={(event) => {
                        const nextIngredient = ingredients.find((item) => item.id === event.target.value);
                        setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ingredient_id: event.target.value, unit: defaultUnit(nextIngredient) } : item));
                      }}>
                        <option value="">Выберите</option>
                        {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label></td>
                    <td><label className={styles.field}>
                      <span className="sr-only">Количество сырья {index + 1}</span>
                      <input type="number" min="0.001" step="0.001" value={component.quantity} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: numericValue(event.target.value) } : item))} />
                    </label></td>
                    <td><label className={styles.field}>
                      <span className="sr-only">Единица сырья {index + 1}</span>
                      <select value={component.unit} onChange={(event) => setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value as ProductionUnit } : item))}>
                        {allowedUnits(ingredient).map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
                      </select>
                    </label></td>
                    <td><label className={styles.check}>
                      <input type="radio" name="primary_component" checked={component.is_primary} onChange={() => setComponents((current) => current.map((item, itemIndex) => ({ ...item, is_primary: itemIndex === index })))} />
                      <span className="sr-only">Основное сырьё: {ingredient?.name ?? index + 1}</span>
                    </label></td>
                    <td className={styles.numeric}>{formatRub(lineCost, 2)}</td>
                    <td><button type="button" aria-label={`Удалить сырьё ${index + 1}`} title="Удалить сырьё" onClick={() => setComponents((current) => current.filter((_, itemIndex) => itemIndex !== index))} className={`${styles.iconButton} ${styles.danger}`}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {!components.length ? <p className={styles.empty}>Сырьё не добавлено.</p> : null}
        </section>

        <section className={styles.section} aria-labelledby="recipe-expenses-heading">
          <div className={styles.sectionHeading}>
            <h2 id="recipe-expenses-heading">Прямые расходы</h2>
            <button type="button" onClick={() => setExpenses((current) => [...current, { amount_per_batch: 0, category: "other", name: "", sort_order: (current.length + 1) * 100 }])} className={styles.button}><Plus size={15} />Добавить расход</button>
          </div>
          {expenses.length ? (
            <div className={styles.tableScroll} role="region" aria-label="Прямые расходы" tabIndex={0}>
              <table className={`${styles.table} ${styles.lineItems}`}>
                <thead><tr><th scope="col">Статья</th><th scope="col">Тип</th><th scope="col">₽ на партию</th><th scope="col"><span className="sr-only">Действия</span></th></tr></thead>
                <tbody>{expenses.map((expense, index) => (
                  <tr key={index}>
                    <td><label className={styles.field}><span className="sr-only">Статья расхода {index + 1}</span><input value={expense.name} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Например: работа смены" /></label></td>
                    <td><label className={styles.field}><span className="sr-only">Тип расхода {index + 1}</span><select value={expense.category} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value as ExpenseDraft["category"] } : item))}>{expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label></td>
                    <td><label className={styles.field}><span className="sr-only">Сумма расхода {index + 1}</span><input type="number" min="0" step="0.01" value={expense.amount_per_batch} onChange={(event) => setExpenses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount_per_batch: numericValue(event.target.value) } : item))} /></label></td>
                    <td><button type="button" aria-label={`Удалить расход ${index + 1}`} title="Удалить расход" onClick={() => setExpenses((current) => current.filter((_, itemIndex) => itemIndex !== index))} className={`${styles.iconButton} ${styles.danger}`}><Trash2 size={15} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className={styles.empty}>Прямых расходов пока нет.</p>}
        </section>

        <button type="submit" className={styles.primary}><Save size={15} />{recipe ? "Сохранить карту" : "Создать карту"}</button>
      </div>

      <aside className={styles.summary}>
        <h2>Расчёт одной партии</h2>
        <dl>
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
        <div className={styles.monthlyPlan}>
          <p className={styles.muted}>План на месяц</p>
          <strong>{formatRub(metrics.plannedMonthlyGrossProfit, 2)}</strong>
          <p className={styles.muted}>расчётная валовая прибыль при {formatNumber(plannedBatches, 1)} партиях</p>
        </div>
      </aside>
    </form>
  );
}

function Result({ label, value, strong = false }: { label: string; strong?: boolean; value: string }) {
  return <div className={`${styles.result} ${strong ? styles.resultStrong : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}
