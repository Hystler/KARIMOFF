import Link from "next/link";
import { redirect } from "next/navigation";
import { ActualManagementResultCalculator } from "@/components/admin/ActualManagementResult";
import { EconomicsCalculator } from "@/components/admin/EconomicsCalculator";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { parseAnalyticsFilters } from "@/lib/analytics/filters";
import { getAnalyticsScope } from "@/lib/analytics/permissions";
import { addCalendarDays, countAnalyticsCalendarDays, getAnalyticsRange } from "@/lib/analytics/periods";
import { getActualManagementResult } from "@/lib/economics-actual";
import { getAdminEconomicsSettings } from "@/lib/economics";
import { formatPercent, formatRub } from "@/lib/format";
import { getProductsFoodCosts } from "@/lib/ingredients";
import { getInventoryStockValue } from "@/lib/inventory";
import { getAdminProducts } from "@/lib/products";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const periodOptions = [
  ["today", "Сегодня"],
  ["yesterday", "Вчера"],
  ["7d", "Последние 7 дней"],
  ["30d", "Последние 30 дней"],
  ["this_week", "Текущая неделя"],
  ["last_week", "Прошлая неделя"],
  ["this_month", "Текущий месяц"],
  ["last_month", "Прошлый месяц"],
  ["this_quarter", "Текущий квартал"],
  ["custom", "Свой период"]
] as const;

function foodCostTone(value: number | null) {
  if (value === null) {
    return "bg-karimoff-black/5 text-karimoff-muted";
  }

  if (value < 30) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (value < 40) {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

export default async function AdminEconomicsPage({ searchParams }: PageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const rawParams = searchParams ? await searchParams : {};
  const filters = parseAnalyticsFilters(rawParams);
  const range = getAnalyticsRange({
    period: filters.period,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  });
  const [productsResult, economicsResult, inventoryStock, analyticsScope] = await Promise.all([
    getAdminProducts(),
    getAdminEconomicsSettings(),
    getInventoryStockValue(),
    getAnalyticsScope()
  ]);
  const actualManagementResult = await getActualManagementResult({ filters, range, scope: analyticsScope });
  const productEconomics = productsResult.error
    ? {
        items: [],
        error: productsResult.error
      }
    : await getProductsFoodCosts(productsResult.products);
  const activeItems = productEconomics.items.filter((item) => item.product.is_active);
  const completeActiveItems = activeItems.filter((item) => item.is_complete);
  const bestProfitItem = [...completeActiveItems].sort(
    (left, right) => (right.gross_profit ?? Number.NEGATIVE_INFINITY) - (left.gross_profit ?? Number.NEGATIVE_INFINITY)
  )[0];
  const bestMarginItem = [...completeActiveItems].sort(
    (left, right) =>
      (right.gross_margin_percent ?? Number.NEGATIVE_INFINITY) -
      (left.gross_margin_percent ?? Number.NEGATIVE_INFINITY)
  )[0];
  const sortedItems = [...productEconomics.items].sort((left, right) => {
    if (left.product.is_active !== right.product.is_active) {
      return left.product.is_active ? -1 : 1;
    }

    return (right.gross_profit ?? Number.NEGATIVE_INFINITY) - (left.gross_profit ?? Number.NEGATIVE_INFINITY);
  });

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Экономика точки</h1>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
        </header>

        {economicsResult.error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {economicsResult.error}
          </div>
        ) : null}

        <form method="get" className="mt-8 grid gap-4 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:grid-cols-[minmax(220px,1fr)_minmax(170px,0.7fr)_minmax(170px,0.7fr)_auto] sm:items-end">
          <label className="admin-field">Период<select name="period" defaultValue={filters.period}>{periodOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="admin-field">С даты<input type="date" name="from" defaultValue={filters.dateFrom ?? range.fromDateKey} /></label>
          <label className="admin-field">По дату<input type="date" name="to" defaultValue={filters.dateTo ?? addCalendarDays(range.toDateKeyExclusive, -1)} /></label>
          <button type="submit" className="admin-primary-button">Показать</button>
        </form>

        <ActualManagementResultCalculator
          key={`${range.fromDateKey}:${range.toDateKeyExclusive}`}
          actual={actualManagementResult}
          calendarDays={countAnalyticsCalendarDays(range)}
          initialValues={economicsResult.settings}
          rangeLabel={range.label}
        />

        <section className="mt-8 border-t border-karimoff-line pt-8">
          <p className="admin-eyebrow">Планирование</p>
          <h2 className="mt-2 text-3xl font-black">Плановый сценарий точки</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-karimoff-muted">Сохранённые вводные используются как база для прогноза и начальные значения фактического расчёта выше.</p>
        </section>

        <EconomicsCalculator initialValues={economicsResult.settings} />

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
          <p className="text-sm font-semibold text-karimoff-orange">Склад</p>
          <h2 className="mt-2 text-3xl font-black">Складская стоимость остатков</h2>
          {inventoryStock.error ? (
            <p className="mt-4 text-sm font-semibold text-amber-700">{inventoryStock.error}</p>
          ) : (
            <p className="mt-4 text-4xl font-black text-karimoff-orange">{formatRub(inventoryStock.value, 2)}</p>
          )}
          <p className="mt-3 max-w-2xl text-sm leading-6 text-karimoff-muted">
            Остатки считаются по складским карточкам ингредиентов, стоимость — по текущей себестоимости ингредиента.
          </p>
        </section>

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          <div className="border-b border-karimoff-line p-5">
            <p className="text-sm font-semibold text-karimoff-orange">Себестоимость</p>
            <h2 className="mt-2 text-3xl font-black">Юнит-экономика товаров</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-karimoff-muted">
              Валовая прибыль с единицы — цена продажи минус food cost. Это показатель до зарплат, аренды,
              налогов, эквайринга и других расходов, а не чистая прибыль бизнеса.
            </p>
          </div>
          {productEconomics.error ? (
            <div className="p-6 text-sm font-semibold text-red-600">{productEconomics.error}</div>
          ) : productEconomics.items.length === 0 ? (
            <div className="p-6 text-sm text-karimoff-muted">Товары пока не загружены.</div>
          ) : (
            <>
              <div className="grid gap-3 border-b border-karimoff-line p-5 md:grid-cols-3">
                <article className="rounded-lg border border-karimoff-line bg-karimoff-soft p-4">
                  <p className="text-xs font-bold uppercase text-karimoff-muted">Food cost рассчитан</p>
                  <p className="mt-2 text-2xl font-black text-karimoff-black">
                    {completeActiveItems.length} из {activeItems.length}
                  </p>
                  <p className="mt-1 text-xs text-karimoff-muted">активных позиций меню</p>
                </article>
                <article className="rounded-lg border border-karimoff-line bg-karimoff-soft p-4">
                  <p className="text-xs font-bold uppercase text-karimoff-muted">Лучшая прибыль с единицы</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">
                    {formatRub(bestProfitItem?.gross_profit, 2)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-karimoff-black">
                    {bestProfitItem?.product.name ?? "Нет полного расчёта"}
                  </p>
                </article>
                <article className="rounded-lg border border-karimoff-line bg-karimoff-soft p-4">
                  <p className="text-xs font-bold uppercase text-karimoff-muted">Лучшая валовая маржа</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">
                    {formatPercent(bestMarginItem?.gross_margin_percent)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-karimoff-black">
                    {bestMarginItem?.product.name ?? "Нет полного расчёта"}
                  </p>
                </article>
              </div>
              <div className="overflow-x-auto">
                <table className="admin-table min-w-[980px]">
                  <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                    <tr>
                      <th className="px-4 py-4 font-bold">Товар</th>
                      <th className="px-4 py-4 font-bold">Цена</th>
                      <th className="px-4 py-4 font-bold">Себестоимость</th>
                      <th className="px-4 py-4 font-bold">Food cost, %</th>
                      <th className="px-4 py-4 font-bold">Прибыль с единицы</th>
                      <th className="px-4 py-4 font-bold">Валовая маржа</th>
                      <th className="px-4 py-4 font-bold">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item) => (
                      <tr
                        key={item.product.id}
                        className={`border-b border-karimoff-line last:border-b-0 ${item.product.is_active ? "" : "bg-karimoff-soft/60 opacity-70"}`}
                      >
                        <td className="px-4 py-4">
                          <p className="font-bold text-karimoff-black">{item.product.name}</p>
                          <p className="mt-1 text-xs text-karimoff-muted">
                            {item.product.category}{item.product.is_active ? "" : " · скрыт"}
                          </p>
                        </td>
                        <td className="px-4 py-4 font-black text-karimoff-orange">{formatRub(item.product.price)}</td>
                        <td className="px-4 py-4">{formatRub(item.food_cost, 2)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${foodCostTone(item.food_cost_percent)}`}>
                            {formatPercent(item.food_cost_percent)}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-bold">{formatRub(item.gross_profit, 2)}</td>
                        <td className="px-4 py-4">{formatPercent(item.gross_margin_percent)}</td>
                        <td className="px-4 py-4 text-xs font-semibold text-karimoff-muted">
                          {item.lines.length === 0
                            ? "Нужно добавить состав товара"
                            : item.missing_price_ingredients.length
                              ? `Не заполнены цены: ${item.missing_price_ingredients.join(", ")}`
                              : item.food_cost_percent && item.food_cost_percent >= 40
                                ? "Критично"
                                : item.food_cost_percent && item.food_cost_percent >= 30
                                  ? "Внимание"
                                  : "Норм"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
