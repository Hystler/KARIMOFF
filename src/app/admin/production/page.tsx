import { ChevronDown, CircleAlert, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductionRunForm } from "@/components/admin/ProductionRunForm";
import styles from "@/components/admin/OperationsWorkspace.module.css";
import { getCurrentStaff } from "@/lib/admin-auth";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";
import { formatInventoryQuantity } from "@/lib/inventory";
import { getProductionOutputCostLabel, getProductionWorkspace, type ProductionOverhead } from "@/lib/production";
import { completeProductionRunAction, deleteProductionOverheadAction, saveProductionOverheadAction } from "./actions";

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
  if (!staff || !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin/login");
  const params = searchParams ? await searchParams : {};
  const workspace = await getProductionWorkspace();
  const activeRecipes = workspace.recipes.filter((recipe) => recipe.is_active);
  const plannedRevenue = activeRecipes.reduce((sum, recipe) => sum + recipe.metrics.plannedMonthlyRevenue, 0);
  const plannedGrossProfit = activeRecipes.reduce((sum, recipe) => sum + recipe.metrics.plannedMonthlyGrossProfit, 0);
  const message = savedMessage(params.saved);

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div><p className={styles.muted}>Цех и полуфабрикаты</p><h1>Производство</h1></div>
        <Link href="/admin/production/new" className={styles.primary}><Plus size={15} />Новая карта</Link>
      </header>
      {message ? <div role="status" className={styles.notice} data-tone="success">{message}</div> : null}
      {params.error ? <div role="alert" className={styles.notice} data-tone="error">{params.error}</div> : null}
      {workspace.error ? <div role="alert" className={styles.notice} data-tone="error">{workspace.error}</div> : null}
      {workspace.notConfigured ? <div className={styles.notice} data-tone="warning">База данных не подключена.</div> : null}

      <section className={styles.metrics} aria-label="Сводка производства">
        <div><span>Активных карт</span><strong>{formatNumber(activeRecipes.length)}</strong></div>
        <div><span>OPEX / месяц</span><strong>{formatRub(workspace.monthlyOverhead)}</strong></div>
        <div><span>Плановая выручка / месяц</span><strong>{formatRub(plannedRevenue)}</strong></div>
        <div><span>Плановая валовая прибыль</span><strong>{formatRub(plannedGrossProfit)}</strong></div>
      </section>
      {workspace.recipes.length && workspace.totalPlannedMinutes <= 0 && workspace.monthlyOverhead > 0 ? (
        <div className={styles.notice} data-tone="warning"><CircleAlert size={16} /><span>Заполните план партий в картах. Пока он равен нулю, зарплата, аренда и другие ежемесячные расходы не распределяются в полную себестоимость.</span></div>
      ) : null}

      <section className={styles.section} aria-labelledby="production-recipes-heading">
        <div className={styles.sectionHeading}>
          <h2 id="production-recipes-heading">Карты производства <span className={styles.muted}>({workspace.recipes.length})</span></h2>
          <Link href="/admin/ingredients/prices" className={styles.button}>Обновить цены сырья</Link>
        </div>
        {workspace.recipes.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Карты производства" tabIndex={0}>
            <table className={`${styles.table} ${styles.wideTable}`}>
              <thead><tr><th scope="col">Карта</th><th scope="col">Партия</th><th scope="col">Выход / потери</th><th scope="col" className={styles.numeric}>Материалы</th><th scope="col" className={styles.numeric}>Полная себест.</th><th scope="col" className={styles.numeric}>Цена</th><th scope="col" className={styles.numeric}>Маржа</th><th scope="col">Склад</th><th scope="col">Действия</th></tr></thead>
              <tbody>{workspace.recipes.map((recipe) => {
                const outputCost = getProductionOutputCostLabel(recipe);
                return (
                  <tr key={recipe.id}>
                    <td><strong>{recipe.name}</strong><span className={styles.subline}>{recipe.category ?? recipe.output_ingredient.name}</span><span className={styles.status} data-tone={recipe.is_active ? "normal" : "inactive"}>{recipe.is_active ? "Активна" : "Выключена"}</span></td>
                    <td><strong className={styles.numeric}>{formatNumber(recipe.output_quantity, 3)} {recipe.output_unit}</strong><span className={styles.subline}>{recipe.batch_duration_minutes} мин.</span></td>
                    <td><strong>{formatPercent(recipe.metrics.yieldPercent)}</strong><span className={styles.subline}>потери {formatPercent(recipe.metrics.lossPercent)}</span></td>
                    <td className={styles.numeric}>{formatRub(recipe.metrics.materialCost, 2)}</td>
                    <td className={styles.numeric}><strong>{formatRub(recipe.metrics.totalCost, 2)}</strong><span className={styles.subline}>{formatRub(outputCost.amount, 2)} {outputCost.label}</span></td>
                    <td className={styles.numeric}><strong>{formatRub(recipe.sale_price_per_output_unit, 2)} / {recipe.output_unit}</strong><span className={styles.subline}>партия {formatRub(recipe.metrics.plannedRevenue, 2)}</span></td>
                    <td className={styles.numeric}><strong className={recipe.metrics.grossMarginPercent !== null && recipe.metrics.grossMarginPercent < 0 ? styles.negative : styles.positive}>{formatPercent(recipe.metrics.grossMarginPercent)}</strong><span className={styles.subline}>{formatRub(recipe.metrics.grossProfit, 2)}</span></td>
                    <td><strong className={styles.numeric}>{formatInventoryQuantity(recipe.output_stock, recipe.output_ingredient.unit)}</strong><span className={styles.subline}>сырья на {recipe.available_batches} парт.</span></td>
                    <td><Link href={`/admin/production/${recipe.id}/edit`} className={styles.iconButton} title="Открыть карту" aria-label={`Открыть карту: ${recipe.name}`}><Pencil size={15} /></Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>Производственных карт пока нет. Создайте первую карту для мяса, соуса или другой заготовки.</p>}
      </section>

      <ProductionRunForm action={completeProductionRunAction} recipes={workspace.recipes} />

      <section className={styles.section} aria-labelledby="production-overhead-heading">
        <div className={styles.sectionHeading}><h2 id="production-overhead-heading">Ежемесячная база</h2><span className={styles.muted}>{formatRub(workspace.monthlyOverhead)} / месяц</span></div>
        <details className={`${styles.disclosure} group`}>
          <summary><WalletCards size={16} />Новый ежемесячный расход<ChevronDown size={16} className="ml-auto transition-transform group-open:rotate-180" /></summary>
          <div className={styles.disclosureBody}><OverheadForm /></div>
        </details>
        {workspace.overheads.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Ежемесячные расходы" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Статья</th><th scope="col">Категория</th><th scope="col" className={styles.numeric}>Кол-во</th><th scope="col" className={styles.numeric}>Ставка</th><th scope="col" className={styles.numeric}>В месяц</th><th scope="col">Комментарий</th><th scope="col">Действия</th></tr></thead>
              <tbody>{workspace.overheads.map((overhead) => (
                <tr key={overhead.id}>
                  <td><strong>{overhead.name}</strong>{!overhead.is_active ? <span className={styles.subline}>Не учитывается</span> : null}</td>
                  <td>{overheadCategories.find((category) => category.value === overhead.category)?.label ?? "Другое"}</td>
                  <td className={styles.numeric}>{formatNumber(overhead.quantity, 2)}</td>
                  <td className={styles.numeric}>{formatRub(overhead.amount_per_unit, 2)}</td>
                  <td className={styles.numeric}><strong>{formatRub(overhead.monthly_amount, 2)}</strong></td>
                  <td className={`${styles.comment} ${styles.muted}`}>{overhead.comment ?? "—"}</td>
                  <td><div className={styles.actions}>
                    <details className={styles.rowDisclosure}>
                      <summary className={styles.iconButton} title="Изменить расход" aria-label={`Изменить расход: ${overhead.name}`}><Pencil size={15} /></summary>
                      <OverheadForm overhead={overhead} />
                    </details>
                    <form action={deleteProductionOverheadAction}><input type="hidden" name="id" value={overhead.id} /><button type="submit" className={`${styles.iconButton} ${styles.danger}`} title="Удалить расход" aria-label={`Удалить расход: ${overhead.name}`}><Trash2 size={15} /></button></form>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>Ежемесячные расходы пока не добавлены.</p>}
      </section>

      <section className={styles.section} aria-labelledby="production-runs-heading">
        <div className={styles.sectionHeading}><h2 id="production-runs-heading">Последние выпуски</h2><span className={styles.muted}>Фактические партии</span></div>
        {workspace.runs.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Последние выпуски" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Дата / карта</th><th scope="col" className={styles.numeric}>Партий</th><th scope="col" className={styles.numeric}>Выход</th><th scope="col" className={styles.numeric}>Себестоимость</th><th scope="col" className={styles.numeric}>Выручка</th><th scope="col" className={styles.numeric}>Прибыль</th><th scope="col" className={styles.numeric}>Маржа</th><th scope="col">Кто провёл</th></tr></thead>
              <tbody>{workspace.runs.map((run) => (
                <tr key={run.id}>
                  <td><strong>{run.recipe_name}</strong><span className={styles.subline}>{formatRunDate(run.run_date)}</span></td>
                  <td className={styles.numeric}>{formatNumber(run.batch_count, 2)}</td>
                  <td className={styles.numeric}>{formatNumber(run.output_quantity, 3)} {run.output_unit}</td>
                  <td className={styles.numeric}><strong>{formatRub(run.total_cost, 2)}</strong></td>
                  <td className={styles.numeric}>{formatRub(run.planned_revenue, 2)}</td>
                  <td className={styles.numeric}><strong className={run.gross_profit < 0 ? styles.negative : styles.positive}>{formatRub(run.gross_profit, 2)}</strong></td>
                  <td className={styles.numeric}>{formatPercent(run.gross_margin_percent)}</td>
                  <td className={styles.muted}>{run.created_by}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>Фактических выпусков пока нет.</p>}
      </section>
    </main>
  );
}

function OverheadForm({ overhead }: { overhead?: ProductionOverhead }) {
  return (
    <form action={saveProductionOverheadAction} className={overhead ? styles.editForm : undefined}>
      {overhead ? <input type="hidden" name="id" value={overhead.id} /> : null}
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.spanTwo}`}>Название<input name="name" required defaultValue={overhead?.name ?? ""} placeholder="Зарплата производственной смены" /></label>
        <label className={styles.field}>Категория<select name="category" defaultValue={overhead?.category ?? "payroll"}>{overheadCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        <label className={styles.field}>Количество<input name="quantity" type="number" min="0" step="0.01" defaultValue={overhead?.quantity ?? 1} /></label>
        <label className={styles.field}>Сумма за единицу, ₽<input name="amount_per_unit" type="number" min="0" step="0.01" defaultValue={overhead?.amount_per_unit ?? 0} /></label>
        {overhead ? <input type="hidden" name="sort_order" value={overhead.sort_order} /> : <label className={styles.field}>Порядок<input name="sort_order" type="number" min="0" step="1" defaultValue="100" /></label>}
        <label className={`${styles.field} ${styles.spanTwo}`}>Комментарий<input name="comment" defaultValue={overhead?.comment ?? ""} placeholder="Ставка, источник или пояснение" /></label>
      </div>
      <div className={styles.formFooter}>
        <label className={styles.check}><input name="is_active" type="checkbox" defaultChecked={overhead?.is_active ?? true} />Учитывать в расчёте</label>
        <button type="submit" className={styles.primary}>{overhead ? "Сохранить" : "Добавить расход"}</button>
      </div>
    </form>
  );
}
