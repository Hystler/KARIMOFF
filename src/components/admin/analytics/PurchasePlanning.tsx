import Link from "next/link";
import { AlertTriangle, CalendarDays, PackageCheck, ShoppingBasket } from "lucide-react";
import { formatRub } from "@/lib/format";
import type { getPurchasePlanning } from "@/lib/analytics/planning";

type Plan = Awaited<ReturnType<typeof getPurchasePlanning>>;
const number = (value: number, digits = 1) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
const quantity = (value: number | null, unit: string) => value === null ? "Нет остатка в учёте" : `${number(value)} ${unit === "g" ? "г" : unit === "ml" ? "мл" : "шт"}`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00Z`));

export function PurchasePlanning({ plan }: { plan: Plan }) {
  const incomplete = plan.products.filter((product) => product.issue);
  return <>
    <form className="flex flex-wrap items-end gap-4 border-y border-karimoff-line py-5" method="get">
      <label className="grid gap-2 text-sm font-semibold">История продаж
        <select name="history" defaultValue={plan.options.history} className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3">
          <option value="28">4 недели</option><option value="56">8 недель</option><option value="84">12 недель</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold">Закупка на
        <select name="days" defaultValue={plan.options.horizon} className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3">
          {[1, 2, 3, 7, 14].map((days) => <option key={days} value={days}>{days} {days === 1 ? "день" : days < 5 ? "дня" : "дней"}</option>)}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold">Страховой запас
        <select name="buffer" defaultValue={plan.options.bufferDays} className="min-h-11 rounded-lg border border-karimoff-line bg-white px-3">
          <option value="0">Без запаса</option>{[1, 2, 3, 7].map((days) => <option key={days} value={days}>+{days} {days === 1 ? "день" : days < 5 ? "дня" : "дней"}</option>)}
        </select>
      </label>
      <button className="public-button-primary min-h-11 px-5" type="submit"><CalendarDays size={17} />Рассчитать</button>
      <span className="pb-3 text-sm text-karimoff-muted">{date(plan.from)} — {date(plan.through)} · все каналы</span>
    </form>

    <section className="grid gap-5 border-b border-karimoff-line py-6 sm:grid-cols-2 xl:grid-cols-4" aria-label="Показатели планирования">
      <div><p className="text-sm text-karimoff-muted">Заказов в день, без возвратов</p><p className="mt-2 text-2xl font-bold">{number(plan.averageOrders)}</p></div>
      <div><p className="text-sm text-karimoff-muted">Продажи с полной рецептурой</p><p className="mt-2 text-2xl font-bold">{plan.coverage === null ? "Нет продаж" : `${number(plan.coverage)}%`}</p></div>
      <div><p className="text-sm text-karimoff-muted">Закончится раньше закупочного периода</p><p className="mt-2 text-2xl font-bold text-red-700">{plan.rows.filter((row) => row.daysLeft !== null && row.daysLeft < plan.options.horizon).length}</p></div>
      <div><p className="text-sm text-karimoff-muted">Закупка по известным ценам</p><p className="mt-2 text-2xl font-bold text-emerald-700">{formatRub(plan.knownBudget, 0)}</p></div>
    </section>

    {plan.activeDays < plan.days || plan.missingStock > 0 || plan.missingPrices > 0 || incomplete.length > 0 ? <div role="status" className="my-5 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <AlertTriangle size={19} className="mt-1 shrink-0" /><div>
        <p className="font-bold">Прогноз требует проверки покрытия</p>
        <p>Дней с продажами: {plan.activeDays} из {plan.days}. Без складского остатка: {plan.missingStock}. Без цены закупки: {plan.missingPrices}. Товаров вне расчёта: {incomplete.length}.</p>
        <p>Дни без продаж включены в среднее. Пропуски синхронизации могут занижать прогноз.</p>
      </div>
    </div> : null}
    <section className="py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-bold"><ShoppingBasket size={21} />Ингредиенты к закупке</h2><Link href="/admin/inventory" className="text-sm font-semibold underline underline-offset-4">Складские остатки</Link></header>
      <p className="mb-4 text-sm leading-6 text-karimoff-muted">Продажи без возвратов, базовые рецептуры, дни недели и технологические отходы. Платные добавки, срок годности и время поставки в прогноз не включены.</p>
      <div className="overflow-x-auto">
        <table aria-label="Ингредиенты к закупке" className="w-full min-w-[940px] text-left text-sm">
          <thead className="border-y border-karimoff-line bg-gray-50 text-xs text-gray-600"><tr>{["Ингредиент", "В день", "На период", "Доступно", "Запас, дней", "К закупке", "Упаковок", "Сумма"].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{plan.rows.map((row) => <tr key={row.id} className="border-b border-karimoff-line hover:bg-gray-50">
            <td className="max-w-[240px] px-3 py-4 font-semibold"><Link href={`/admin/ingredients/${row.id}/edit`} className="hover:underline">{row.name}</Link></td>
            <td className="whitespace-nowrap px-3 py-4 tabular-nums">{quantity(row.perDay, row.unit)}</td>
            <td className="whitespace-nowrap px-3 py-4 tabular-nums">{quantity(row.demand, row.unit)}</td>
            <td className="px-3 py-4 tabular-nums">{quantity(row.available, row.unit)}</td>
            <td className={`px-3 py-4 font-semibold tabular-nums ${row.daysLeft !== null && row.daysLeft < plan.options.horizon ? "text-red-700" : "text-emerald-700"}`}>{row.available === null ? "—" : row.daysLeft === null ? ">365" : number(row.daysLeft)}</td>
            <td className="whitespace-nowrap px-3 py-4 font-semibold tabular-nums">{row.purchase === null ? "Уточнить остаток" : quantity(row.purchase, row.unit)}</td>
            <td className="px-3 py-4 tabular-nums">{row.packages === null ? "—" : number(row.packages, 0)}</td>
            <td className="whitespace-nowrap px-3 py-4 tabular-nums">{row.budget === null ? "Не рассчитана" : formatRub(row.budget, 0)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!plan.rows.length ? <p className="py-8 text-karimoff-muted">Нет продаж с полной рецептурой за выбранный период.</p> : null}
      <p className="mt-4 text-sm leading-6 text-karimoff-muted">Остаток за вычетом резервов. Закупка включает страховой запас и минимальный остаток, округляется до упаковки, если её размер известен. Складские движения не создаются.</p>
    </section>

    <section className="border-t border-karimoff-line py-6">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><PackageCheck size={21} />План по блюдам</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm">
        <thead className="border-y border-karimoff-line bg-gray-50"><tr>{["Товар", "Продано", "В день", "На период", "Рецептура"].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{plan.products.map((product, index) => <tr key={`${product.id ?? product.name}-${index}`} className="border-b border-karimoff-line"><td className="px-3 py-3 font-semibold">{product.name}</td><td className="px-3 py-3 tabular-nums">{number(product.sold)}</td><td className="px-3 py-3 tabular-nums">{number(product.perDay)}</td><td className="px-3 py-3 tabular-nums">{product.issue ? "—" : number(product.forecast)}</td><td className={`px-3 py-3 ${product.issue ? "text-amber-800" : "text-emerald-700"}`}>{product.issue ?? "Учтена"}</td></tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
