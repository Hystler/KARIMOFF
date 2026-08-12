import { CircleAlert, Factory, PackageCheck, Plus, TimerReset, WalletCards } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductionRunForm } from "@/components/admin/ProductionRunForm";
import { getCurrentStaff } from "@/lib/admin-auth";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";
import { formatInventoryQuantity } from "@/lib/inventory";
import { getProductionOutputCostLabel, getProductionWorkspace } from "@/lib/production";
import {
  completeProductionRunAction,
  deleteProductionOverheadAction,
  saveProductionOverheadAction
} from "./actions";

type PageProps = { searchParams?: Promise<{ error?: string; saved?: string }> };

const overheadCategories = [
  { label: "Фонд оплаты труда", value: "payroll" },
  { label: "Аренда", value: "rent" },
  { label: "Коммунальные", value: "utilities" },
  { label: "Санитария и лаборатория", value: "sanitation" },
  { label: "Ремонт оборудования", value: "maintenance" },
  { label: "Бухгалтерия", value: "accounting" },
  { label: "Канцелярия", value: "stationery" },
  { label: "Логистика", value: "logistics" },
  { label: "Другое", value: "other" }
] as const;

export const dynamic = "force-dynamic";

function savedMessage(value?: string) {
  if (value === "recipe") return "Производственная карта сохранена.";
  if (value === "overhead") return "Ежемесячный расход сохранён.";
  if (value === "overhead_deleted") return "Расход удалён.";
  if (value === "run") return "Выпуск проведён: склад и себестоимость полуфабриката обновлены.";
  return null;
}

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export default async function ProductionPage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role === "cook") redirect("/admin/login");
  const params = searchParams ? await searchParams : {};
  const workspace = await getProductionWorkspace();
  const activeRecipes = workspace.recipes.filter((recipe) => recipe.is_active);
  const plannedRevenue = activeRecipes.reduce((sum, recipe) => sum + recipe.metrics.plannedMonthlyRevenue, 0);
  const plannedGrossProfit = activeRecipes.reduce((sum, recipe) => sum + recipe.metrics.plannedMonthlyGrossProfit, 0);
  const message = savedMessage(params.saved);

  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Цех и полуфабрикаты</p>
          <h1>Производство</h1>
          <p>Сырьё, выход после обработки, себестоимость партии, ежемесячные расходы и цена продажи франчайзи в одном расчёте.</p>
        </div>
        <Link href="/admin/production/new" className="admin-primary-button"><Plus size={18} />Новая карта</Link>
      </header>

      {message ? <div className="admin-alert admin-alert-success">{message}</div> : null}
      {params.error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(params.error)}</div> : null}
      {workspace.error ? <div className="admin-alert admin-alert-error">{workspace.error}</div> : null}
      {workspace.notConfigured ? <div className="admin-alert admin-alert-warning">База данных не подключена.</div> : null}

      <section className="admin-metrics">
        <article><span>Активных карт</span><strong>{formatNumber(activeRecipes.length)}</strong></article>
        <article><span>OPEX производства / месяц</span><strong>{formatRub(workspace.monthlyOverhead)}</strong></article>
        <article><span>Плановая выручка / месяц</span><strong>{formatRub(plannedRevenue)}</strong></article>
        <article><span>Плановая валовая прибыль</span><strong>{formatRub(plannedGrossProfit)}</strong></article>
      </section>

      {workspace.recipes.length && workspace.totalPlannedMinutes <= 0 && workspace.monthlyOverhead > 0 ? (
        <div className="admin-alert admin-alert-warning mt-6 flex items-start gap-3">
          <CircleAlert className="mt-0.5 shrink-0" size={19} />
          <span>Заполните план партий в картах. Пока он равен нулю, зарплата, аренда и другие ежемесячные расходы не распределяются в полную себестоимость.</span>
        </div>
      ) : null}

      <section className="admin-card mt-7 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-karimoff-line p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <p className="admin-eyebrow">Калькуляция</p>
            <h2 className="mt-2 text-xl font-black">Карты производства</h2>
            <p className="mt-2 text-sm leading-6 text-karimoff-muted">Плановые показатели пересчитываются из текущих цен ингредиентов.</p>
          </div>
          <Link href="/admin/ingredients/prices" className="admin-secondary-button">Обновить цены сырья</Link>
        </div>
        {workspace.recipes.length ? (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[1260px]">
              <thead><tr><th>Карта</th><th>Выход партии</th><th>Выход / потери</th><th>Материалы</th><th>Полная себестоимость</th><th>Цена</th><th>Маржа</th><th>Склад</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>
                {workspace.recipes.map((recipe) => {
                  const outputCost = getProductionOutputCostLabel(recipe);
                  return (
                    <tr key={recipe.id}>
                      <td><p className="font-black">{recipe.name}</p><p className="mt-1 text-xs text-karimoff-muted">{recipe.category ?? recipe.output_ingredient.name}</p></td>
                      <td className="font-black tabular-nums">{formatNumber(recipe.output_quantity, 3)} {recipe.output_unit}<p className="mt-1 text-xs font-normal text-karimoff-muted">{recipe.batch_duration_minutes} мин.</p></td>
                      <td><p className="font-bold tabular-nums">{formatPercent(recipe.metrics.yieldPercent)}</p><p className="mt-1 text-xs text-karimoff-muted">потери {formatPercent(recipe.metrics.lossPercent)}</p></td>
                      <td className="font-bold tabular-nums">{formatRub(recipe.metrics.materialCost, 2)}</td>
                      <td><p className="font-black tabular-nums">{formatRub(recipe.metrics.totalCost, 2)}</p><p className="mt-1 text-xs font-bold text-karimoff-orange">{formatRub(outputCost.amount, 2)} {outputCost.label}</p></td>
                      <td><p className="font-black tabular-nums">{formatRub(recipe.sale_price_per_output_unit, 2)} / {recipe.output_unit}</p><p className="mt-1 text-xs text-karimoff-muted">партия {formatRub(recipe.metrics.plannedRevenue, 2)}</p></td>
                      <td><p className={`font-black tabular-nums ${recipe.metrics.grossMarginPercent !== null && recipe.metrics.grossMarginPercent < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatPercent(recipe.metrics.grossMarginPercent)}</p><p className="mt-1 text-xs text-karimoff-muted">{formatRub(recipe.metrics.grossProfit, 2)}</p></td>
                      <td><p className="font-bold">{formatInventoryQuantity(recipe.output_stock, recipe.output_ingredient.unit)}</p><p className="mt-1 text-xs text-karimoff-muted">сырья на {recipe.available_batches} парт.</p></td>
                      <td><span className={`admin-status ${recipe.is_active ? "" : "admin-status-muted"}`}>{recipe.is_active ? "Активна" : "Выключена"}</span></td>
                      <td><Link href={`/admin/production/${recipe.id}/edit`} className="admin-secondary-button">Открыть</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-empty m-5 sm:m-6">Производственных карт пока нет. Создайте первую карту для мяса, соуса или другой заготовки.</p>}
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ProductionRunForm action={completeProductionRunAction} recipes={workspace.recipes} />

        <section className="admin-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-karimoff-orange/10 text-karimoff-orange"><WalletCards size={22} /></span>
            <div><p className="admin-eyebrow">OPEX</p><h2 className="mt-2 text-xl font-black">Новый ежемесячный расход</h2><p className="mt-2 text-sm leading-6 text-karimoff-muted">Например: 3 сотрудника × 85 000 ₽, аренда, электричество или канцелярия.</p></div>
          </div>
          <form action={saveProductionOverheadAction} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="admin-field sm:col-span-2">Название<input name="name" required placeholder="Зарплата производственной смены" /></label>
            <label className="admin-field">Категория<select name="category" defaultValue="payroll">{overheadCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
            <label className="admin-field">Количество<input name="quantity" type="number" min="0" step="0.01" defaultValue="1" /></label>
            <label className="admin-field">Сумма за единицу, ₽<input name="amount_per_unit" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label className="admin-field">Порядок<input name="sort_order" type="number" min="0" step="1" defaultValue="100" /></label>
            <label className="admin-field sm:col-span-2">Комментарий<input name="comment" placeholder="Ставка, источник или пояснение" /></label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-karimoff-line px-4 text-sm font-bold sm:col-span-2"><input name="is_active" type="checkbox" defaultChecked className="h-5 w-5 accent-karimoff-orange" />Учитывать в расчёте</label>
            <button type="submit" className="admin-primary-button sm:col-span-2 sm:w-fit">Добавить расход</button>
          </form>
        </section>
      </div>

      <section className="admin-card mt-7 overflow-hidden">
        <div className="border-b border-karimoff-line p-5 sm:p-6"><p className="admin-eyebrow">Постоянные расходы</p><h2 className="mt-2 text-xl font-black">Ежемесячная база</h2></div>
        {workspace.overheads.length ? (
          <div className="overflow-x-auto"><table className="admin-table min-w-[980px]"><thead><tr><th>Статья</th><th>Категория</th><th>Количество</th><th>Ставка</th><th>В месяц</th><th>Комментарий</th><th>Действия</th></tr></thead><tbody>{workspace.overheads.map((overhead) => (
            <tr key={overhead.id}>
              <td className="font-black">{overhead.name}</td>
              <td>{overheadCategories.find((category) => category.value === overhead.category)?.label ?? "Другое"}</td>
              <td className="tabular-nums">{formatNumber(overhead.quantity, 2)}</td>
              <td className="tabular-nums">{formatRub(overhead.amount_per_unit, 2)}</td>
              <td className="font-black tabular-nums text-karimoff-orange">{formatRub(overhead.monthly_amount, 2)}</td>
              <td className="max-w-[260px] text-xs leading-5 text-karimoff-muted">{overhead.comment ?? "—"}</td>
              <td><div className="flex gap-2"><details><summary className="admin-secondary-button list-none">Изменить</summary><form action={saveProductionOverheadAction} className="mt-3 grid w-[320px] gap-3 rounded-lg border border-karimoff-line bg-white p-4 shadow-card"><input type="hidden" name="id" value={overhead.id} /><label className="admin-field">Название<input name="name" defaultValue={overhead.name} required /></label><label className="admin-field">Категория<select name="category" defaultValue={overhead.category}>{overheadCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="admin-field">Количество<input name="quantity" type="number" min="0" step="0.01" defaultValue={overhead.quantity} /></label><label className="admin-field">Ставка<input name="amount_per_unit" type="number" min="0" step="0.01" defaultValue={overhead.amount_per_unit} /></label></div><input type="hidden" name="sort_order" value={overhead.sort_order} /><label className="admin-field">Комментарий<input name="comment" defaultValue={overhead.comment ?? ""} /></label><label className="flex items-center gap-2 text-sm font-bold"><input name="is_active" type="checkbox" defaultChecked={overhead.is_active} className="accent-karimoff-orange" />Учитывать</label><button type="submit" className="admin-primary-button">Сохранить</button></form></details><form action={deleteProductionOverheadAction}><input type="hidden" name="id" value={overhead.id} /><button type="submit" className="admin-danger-button">Удалить</button></form></div></td>
            </tr>
          ))}</tbody></table></div>
        ) : <p className="admin-empty m-5 sm:m-6">Ежемесячные расходы пока не добавлены.</p>}
      </section>

      <section className="admin-card mt-7 overflow-hidden">
        <div className="grid gap-4 border-b border-karimoff-line p-5 sm:grid-cols-[auto_1fr] sm:items-start sm:p-6"><span className="flex h-11 w-11 items-center justify-center rounded-lg bg-karimoff-orange/10 text-karimoff-orange"><PackageCheck size={22} /></span><div><p className="admin-eyebrow">История</p><h2 className="mt-2 text-xl font-black">Последние выпуски</h2><p className="mt-2 text-sm leading-6 text-karimoff-muted">Фактические партии со снимком себестоимости на момент производства.</p></div></div>
        {workspace.runs.length ? <div className="overflow-x-auto"><table className="admin-table min-w-[980px]"><thead><tr><th>Дата</th><th>Карта</th><th>Партий</th><th>Выход</th><th>Себестоимость</th><th>Выручка</th><th>Прибыль</th><th>Маржа</th><th>Кто провёл</th></tr></thead><tbody>{workspace.runs.map((run) => (
          <tr key={run.id}><td>{formatRunDate(run.run_date)}</td><td className="font-black">{run.recipe_name}</td><td className="tabular-nums">{formatNumber(run.batch_count, 2)}</td><td className="font-bold tabular-nums">{formatNumber(run.output_quantity, 3)} {run.output_unit}</td><td className="font-bold tabular-nums">{formatRub(run.total_cost, 2)}</td><td className="tabular-nums">{formatRub(run.planned_revenue, 2)}</td><td className={`font-black tabular-nums ${run.gross_profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatRub(run.gross_profit, 2)}</td><td className="font-bold tabular-nums">{formatPercent(run.gross_margin_percent)}</td><td className="text-xs text-karimoff-muted">{run.created_by}</td></tr>
        ))}</tbody></table></div> : <p className="admin-empty m-5 sm:m-6">Фактических выпусков пока нет.</p>}
      </section>

      <section className="mt-7 grid gap-4 md:grid-cols-3">
        <article className="admin-card p-5"><TimerReset className="text-karimoff-orange" size={22} /><h3 className="mt-4 font-black">Потери и ужарка</h3><p className="mt-2 text-sm leading-6 text-karimoff-muted">Считаются по основному сырью и фактическому выходу, без скрытых процентов.</p></article>
        <article className="admin-card p-5"><Factory className="text-karimoff-orange" size={22} /><h3 className="mt-4 font-black">Полная себестоимость</h3><p className="mt-2 text-sm leading-6 text-karimoff-muted">Сырьё + расходы партии + доля ежемесячных затрат по времени производства.</p></article>
        <article className="admin-card p-5"><PackageCheck className="text-karimoff-orange" size={22} /><h3 className="mt-4 font-black">Связь с food cost</h3><p className="mt-2 text-sm leading-6 text-karimoff-muted">После выпуска цена полуфабриката обновляется в ингредиентах и пересчитывает блюда.</p></article>
      </section>
    </main>
  );
}
