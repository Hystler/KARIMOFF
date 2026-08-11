import { ChartNoAxesCombined, CircleAlert, CloudDownload, ReceiptText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getErpDashboard } from "@/lib/erp";
import { formatNumber, formatRub } from "@/lib/format";
import { syncEvotorSalesAction } from "./actions";

type ErpPageProps = {
  searchParams?: Promise<{ error?: string; period?: string; synced?: string }>;
};

export const dynamic = "force-dynamic";

const periods = [
  { value: "today", label: "Сегодня" },
  { value: "month", label: "Этот месяц" },
  { value: "30d", label: "30 дней" }
] as const;

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(
    new Date(`${value}T12:00:00+03:00`)
  );
}

export default async function ErpPage({ searchParams }: ErpPageProps) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/admin/kitchen");

  const params = searchParams ? await searchParams : {};
  const dashboard = await getErpDashboard(params.period ?? "today");
  const maxDailyRevenue = Math.max(
    1,
    ...dashboard.daily.map((item) => item.site + item.evotor)
  );

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div className="max-w-3xl">
          <p className="admin-eyebrow">Продажи и касса</p>
          <h1>ERP и аналитика</h1>
          <p>Заказы сайта и чеки Эвотора в одном операционном отчёте.</p>
        </div>
        <form action={syncEvotorSalesAction}>
          <input type="hidden" name="period" value={dashboard.range.period} />
          <button
            type="submit"
            disabled={!dashboard.status.ready}
            className="admin-primary-button disabled:cursor-not-allowed disabled:opacity-45"
          >
            <CloudDownload size={18} />
            Синхронизировать Эвотор
          </button>
        </form>
      </header>

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Период отчёта">
        {periods.map((period) => (
          <Link
            key={period.value}
            href={`/admin/erp?period=${period.value}`}
            className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-bold transition ${
              dashboard.range.period === period.value
                ? "border-karimoff-orange bg-karimoff-orange text-white"
                : "border-karimoff-line bg-white text-karimoff-black hover:border-karimoff-orange"
            }`}
          >
            {period.label}
          </Link>
        ))}
      </nav>

      {params.synced !== undefined ? (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-800">
          Синхронизация завершена. Новых чеков: {params.synced}.
        </div>
      ) : null}
      {params.error || dashboard.error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          {params.error ? decodeURIComponent(params.error) : dashboard.error}
        </div>
      ) : null}

      {!dashboard.status.ready ? (
        <section className="mt-6 flex items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <CircleAlert className="mt-0.5 shrink-0" size={21} />
          <div>
            <h2 className="font-black">Эвотор ожидает подключения</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6">
              Для синхронизации нужны серверные переменные EVOTOR_ENABLED=true, EVOTOR_API_TOKEN и EVOTOR_STORE_ID. Пока они не заданы, раздел безопасно показывает только данные сайта и не обращается к API кассы.
            </p>
          </div>
        </section>
      ) : null}

      <section className="admin-metrics mt-6">
        <article><span>Заказы сайта</span><strong>{formatNumber(dashboard.siteOrders)}</strong></article>
        <article><span>Выручка сайта</span><strong>{formatRub(dashboard.siteRevenue)}</strong></article>
        <article><span>Чеки Эвотор</span><strong>{formatNumber(dashboard.evotorChecks)}</strong></article>
        <article><span>Средний чек</span><strong>{formatRub(dashboard.averageCheck)}</strong></article>
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <section className="admin-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="admin-eyebrow">Динамика</p>
              <h2 className="mt-2 text-xl font-black">Выручка по дням</h2>
            </div>
            <ChartNoAxesCombined className="text-karimoff-orange" size={25} />
          </div>
          {dashboard.daily.length ? (
            <div className="mt-6 grid gap-4">
              {dashboard.daily.map((day) => {
                const total = day.site + day.evotor;
                return (
                  <div key={day.date} className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="text-xs font-bold text-karimoff-muted">{formatDay(day.date)}</span>
                    <div className="h-3 overflow-hidden rounded-full bg-karimoff-soft">
                      <div
                        className="h-full rounded-full bg-karimoff-orange"
                        style={{ width: `${Math.max(2, (total / maxDailyRevenue) * 100)}%` }}
                      />
                    </div>
                    <strong className="text-sm tabular-nums">{formatRub(total)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-6 rounded-lg border border-dashed border-karimoff-line p-5 text-sm text-karimoff-muted">
              За выбранный период выполненных заказов и кассовых чеков нет.
            </p>
          )}
        </section>

        <section className="admin-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="admin-eyebrow">Итог</p>
              <h2 className="mt-2 text-xl font-black">Каналы продаж</h2>
            </div>
            <ReceiptText className="text-karimoff-orange" size={25} />
          </div>
          <dl className="mt-6 grid gap-4 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-karimoff-line pb-4">
              <dt className="text-karimoff-muted">Сайт, выполнено</dt>
              <dd className="font-black tabular-nums">{formatRub(dashboard.siteRevenue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-karimoff-line pb-4">
              <dt className="text-karimoff-muted">Касса Эвотор</dt>
              <dd className="font-black tabular-nums">{formatRub(dashboard.evotorRevenue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 text-base">
              <dt className="font-black">Всего</dt>
              <dd className="font-black tabular-nums text-karimoff-orange">{formatRub(dashboard.totalRevenue)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="admin-card mt-7 overflow-hidden">
        <div className="border-b border-karimoff-line px-5 py-5 sm:px-6">
          <p className="admin-eyebrow">Спрос</p>
          <h2 className="mt-2 text-xl font-black">Популярные позиции</h2>
        </div>
        {dashboard.topProducts.length ? (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[680px]">
              <thead>
                <tr>
                  <th className="px-5 py-4">Позиция</th>
                  <th className="px-5 py-4">Продано</th>
                  <th className="px-5 py-4">Выручка</th>
                  <th className="px-5 py-4">Доля по количеству</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.topProducts.map((product) => {
                  const maxQuantity = dashboard.topProducts[0]?.quantity || 1;
                  return (
                    <tr key={`${product.name}-${product.revenue}`}>
                      <td className="px-5 py-4 font-bold">{product.name}</td>
                      <td className="px-5 py-4 font-black tabular-nums">{formatNumber(product.quantity, 2)}</td>
                      <td className="px-5 py-4 font-black tabular-nums text-karimoff-orange">{formatRub(product.revenue)}</td>
                      <td className="px-5 py-4">
                        <div className="h-2 w-full max-w-[220px] overflow-hidden rounded-full bg-karimoff-soft">
                          <div className="h-full rounded-full bg-karimoff-black" style={{ width: `${(product.quantity / maxQuantity) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-6 text-sm text-karimoff-muted">Пока недостаточно данных для рейтинга.</p>
        )}
      </section>
    </main>
  );
}
