import Link from "next/link";
import { AlertTriangle, CalendarDays, PackageCheck, ShoppingBasket } from "lucide-react";
import { formatRub } from "@/lib/format";
import type { getPurchasePlanning } from "@/lib/analytics/planning";
import { PLANNING_HORIZONS } from "@/lib/analytics/planning-math";
import styles from "./PurchasePlanning.module.css";

type Plan = Awaited<ReturnType<typeof getPurchasePlanning>>;
const number = (value: number, digits = 1) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
const quantity = (value: number | null, unit: string) => value === null ? "Неизвестно" : `${number(value)} ${unit === "g" ? "г" : unit === "ml" ? "мл" : "шт"}`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00Z`));
const percent = (value: number | null) => value === null ? "Нет продаж" : `${number(value)}%`;

export function PurchasePlanning({ plan }: { plan: Plan }) {
  const incomplete = plan.products.filter((product) => product.issue);
  return <div className={styles.plan}>
    <form className={styles.filters} method="get">
      <label>История продаж<select name="history" defaultValue={plan.options.history}>
        <option value="28">4 недели · 28 дней</option><option value="56">8 недель · 56 дней</option><option value="84">12 недель · 84 дня</option>
      </select></label>
      <label>Закупка на<select name="days" defaultValue={plan.options.horizon}>
        {PLANNING_HORIZONS.map((days) => <option key={days} value={days}>{days} {days === 1 ? "день" : days < 5 ? "дня" : "дней"}</option>)}
      </select></label>
      <label>Страховой запас<select name="buffer" defaultValue={plan.options.bufferDays}>
        <option value="0">Без запаса</option>{[1, 2, 3, 7].map((days) => <option key={days} value={days}>+{days} {days === 1 ? "день" : days < 5 ? "дня" : "дней"}</option>)}
      </select></label>
      <button className="public-button-primary" type="submit"><CalendarDays size={17} />Рассчитать</button>
    </form>
    <p className={styles.period}>{date(plan.from)} — {date(plan.through)} · {plan.days} дней истории · все каналы · прогноз на {plan.options.horizon} дней</p>

    <section className={styles.metrics} aria-label="Показатели планирования">
      <div><span>Продажи за историю</span><strong>{formatRub(plan.totalRevenue, 0)}</strong><small>{number(plan.totalUnits)} позиций · {number(plan.averageOrders)} заказов в день</small></div>
      <div><span>Покрытие состава</span><strong>{percent(plan.coverage)}</strong><small>По количеству · по выручке: {percent(plan.revenueCoverage)}</small></div>
      <div><span>Риск дефицита</span><strong className={styles.danger}>{plan.rows.filter((row) => row.daysLeft !== null && row.daysLeft < plan.options.horizon).length}</strong><small>Ингредиентов до конца периода</small></div>
      <div><span>{plan.budgetComplete ? "Бюджет закупки" : "Рассчитанная часть бюджета"}</span><strong>{formatRub(plan.knownBudget, 0)}</strong><small>{plan.budgetComplete ? "По учётным закупочным ценам" : "Не является полным бюджетом"}</small></div>
    </section>

    {!plan.budgetComplete || plan.activeDays < plan.days || plan.stockDeficits > 0 ? <div role="status" className={styles.warning}>
      <AlertTriangle size={20} aria-hidden="true" /><div>
        <strong>{plan.budgetComplete ? "Проверьте исходные данные" : "Бюджет рассчитан не полностью"}</strong>
        <p>Вне расчёта: {incomplete.length} составов · {number(plan.totalUnits - plan.coveredUnits)} позиций · {formatRub(plan.totalRevenue - plan.coveredRevenue, 0)} выручки. Без остатка: {plan.missingStock}. Без цены закупки: {plan.missingPrices}. Без размера упаковки: {plan.missingPackages}.</p>
        {incomplete.length ? <a href="#planning-products">Исключённые позиции и причины</a> : null}
        {plan.stockDeficits > 0 ? <p>Дефицит с резервами: {plan.stockDeficits}; отрицательных остатков: {plan.negativeStock}. Дефицит включён в закупку, учётные данные не изменены.</p> : null}
        <p>Дней с продажами: {plan.activeDays} из {plan.days}. Дни без продаж включены в среднее.</p>
      </div>
    </div> : null}

    <section className={styles.section}>
      <header><h2><ShoppingBasket size={21} aria-hidden="true" />Ингредиенты к закупке</h2><Link href="/admin/inventory">Складские остатки</Link></header>
      <p className={styles.note}>Подтверждённые составы и добавки, спрос по дням недели. Количества — брутто; отходы учтены один раз. Готовые полуфабрикаты остаются отдельными ингредиентами, без предположений о сырье.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Ингредиенты к закупке">
        <table className={styles.ingredients}>
          <thead><tr>{["Ингредиент", "В день", "На период", "В учёте / резерв", "Доступно", "Запас, дней", "К закупке", "Упаковка / кол-во", "Сумма"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{plan.rows.map((row) => <tr key={row.id}>
            <th scope="row"><Link href={`/admin/ingredients/${row.id}/edit`}>{row.name}</Link></th>
            <td>{quantity(row.perDay, row.unit)}</td><td>{quantity(row.demand, row.unit)}<small>Цель с запасом: {quantity(row.target, row.unit)}</small></td>
            <td>{quantity(row.recordedStock, row.unit)}<small>Резерв: {quantity(row.reserved, row.unit)}</small>
              {row.stockDeficit !== null && row.stockDeficit > 0 ? <Link className={styles.danger} href={`/admin/inventory/movements?ingredient_id=${row.id}`}>Дефицит: {quantity(row.stockDeficit, row.unit)} · история</Link> : null}
            </td>
            <td>{quantity(row.available, row.unit)}</td>
            <td className={row.daysLeft !== null && row.daysLeft < plan.options.horizon ? styles.danger : undefined}>{row.available === null ? "Неизвестно" : row.daysLeft === null ? ">365" : number(row.daysLeft)}</td>
            <td>{row.purchase === null ? "Уточнить остаток" : quantity(row.purchase, row.unit)}{row.shortage !== null ? <small>Не хватает: {quantity(row.shortage, row.unit)}</small> : null}</td>
            <td>{row.packageSize === null ? "Размер неизвестен" : quantity(row.packageSize, row.unit)}<small>{row.packages === null ? "Без округления до упаковки" : `${number(row.packages, 0)} уп.`}</small></td>
            <td>{row.budget === null ? "Цена или остаток неизвестны" : formatRub(row.budget, 0)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!plan.rows.length ? <p className={styles.note}>Нет продаж с достоверным составом за выбранный период.</p> : null}
      <p className={styles.note}>Закупка включает страховой запас и минимальный остаток. Цены — текущие учётные закупочные; отсутствующие цены не заменяются нулём. Сроки поставки и годности не включены.</p>
    </section>

    <section className={styles.section} id="planning-products">
      <header><h2><PackageCheck size={21} aria-hidden="true" />Прогноз и диагностика по товарам</h2><span>{plan.products.length} составов · исключено {incomplete.length}</span></header>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Прогноз по товарам и причины исключения">
        <table className={styles.products}>
          <thead><tr>{["Товар / SKU", "Продано", "Выручка", "В день", "Прогноз", "Сопоставление и состав"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{plan.products.map((product) => <tr key={product.key}>
            <th scope="row">{product.name}{product.sku ? <small className={styles.sku}>SKU: {product.sku}</small> : null}</th>
            <td>{number(product.sold)}</td><td>{formatRub(product.revenue, 0)}</td><td>{number(product.perDay)}</td><td>{number(product.forecast)}</td>
            <td className={styles.status}><span className={product.issue ? styles.caution : styles.success}>{product.issue ?? product.compositionSource}</span>
              {product.issue ? <small>{product.detail}{product.recipePresent ? " · Базовая техкарта есть" : " · Подтверждённой техкарты нет"}</small> : <details><summary>Состав брутто на единицу</summary><ul>{product.components.map((line, index) => <li key={`${line.ingredientId}-${index}`}>{line.name}: {quantity(line.gross, line.unit)}</li>)}</ul></details>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.note}>Возвраты не создают отрицательный спрос. Исторические снимки заказов и подтверждённые SKU имеют приоритет над базовой техкартой. Неизвестный размер или модификация исключаются из закупки, но остаются в прогнозе продаж и знаменателе покрытия.</p>
    </section>
  </div>;
}
