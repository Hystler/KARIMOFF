import { ArrowDown, ArrowUp, Download, ReceiptText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AnalyticsFilterBar } from "@/components/admin/analytics/AnalyticsFilterBar";
import { AnalyticsSaleDrawer } from "@/components/admin/analytics/AnalyticsSaleDrawer";
import { AnalyticsSubnav } from "@/components/admin/analytics/AnalyticsSubnav";
import { getCurrentStaff } from "@/lib/admin-auth";
import { analyticsFiltersToParams, parseAnalyticsFilters } from "@/lib/analytics/filters";
import { getChannelLabel } from "@/lib/analytics/channels";
import { getPaymentMethodLabel, getSaleStatusLabel } from "@/lib/analytics/metrics";
import { getAnalyticsScope } from "@/lib/analytics/permissions";
import { getAnalyticsRange } from "@/lib/analytics/periods";
import { getAnalyticsSalesPage } from "@/lib/analytics/sales";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import { formatNumber, formatRub } from "@/lib/format";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

function linkWith(filters: AnalyticsFilters, patch: Record<string, string | null>) {
  const params = analyticsFiltersToParams(filters);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) params.delete(key);
    else params.set(key, value);
  }
  return `/admin/analytics/sales?${params.toString()}`;
}

function SortLink({ label, field, filters }: { label: string; field: AnalyticsFilters["sort"]; filters: AnalyticsFilters }) {
  const active = filters.sort === field;
  const nextDirection = active && filters.direction === "desc" ? "asc" : "desc";
  return (
    <Link href={linkWith(filters, { sort: field === "date" ? null : field, direction: nextDirection === "desc" ? null : nextDirection, page: null })} scroll={false}>
      {label}{active ? filters.direction === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} /> : null}
    </Link>
  );
}

function providerLabel(provider: string) {
  if (provider === "yookassa") return "YooKassa";
  if (provider === "evotor") return "Evotor";
  if (provider === "mixed") return "Несколько";
  return "Не определён";
}

export default async function AnalyticsSalesPage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/kitchen");
  if (staff.role === "cashier") redirect("/pos");

  const raw = searchParams ? await searchParams : {};
  const filters = parseAnalyticsFilters(raw);
  const selectedSaleId = typeof raw.sale === "string" && raw.sale.length <= 200 ? raw.sale : null;
  const range = getAnalyticsRange({ period: filters.period, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  const scope = await getAnalyticsScope();
  const page = await getAnalyticsSalesPage({ filters, range, scope, selectedSaleId });
  const baseParams = analyticsFiltersToParams(filters);
  const closeHref = `/admin/analytics/sales?${baseParams.toString()}`;
  const exportHref = `/api/admin/analytics/sales/export?${baseParams.toString()}`;

  return (
    <main className="admin-content admin-content-wide analytics-page">
      <header className="admin-heading analytics-heading">
        <div>
          <p className="admin-eyebrow">POS + online</p>
          <h1>Журнал продаж</h1>
          <p>Полный серверный журнал операций с поиском, фильтрами и деталями источника.</p>
        </div>
        <a href={exportHref} className="admin-secondary-button">
          <Download size={17} />
          Экспорт CSV
        </a>
      </header>

      <AnalyticsSubnav active="sales" />
      <AnalyticsFilterBar filters={filters} options={page.options} showSearch />

      <section className="analytics-sales-summary">
        <div><span>Найдено операций</span><strong>{formatNumber(page.totalRows)}</strong></div>
        <div><span>Выручка по фильтру</span><strong>{formatRub(page.totalRevenue)}</strong></div>
        <div><span>Период</span><strong>{range.label}</strong></div>
      </section>

      <section className="analytics-panel analytics-sales-panel">
        {page.rows.length ? (
          <>
            <div className="overflow-x-auto analytics-sales-desktop">
              <table className="analytics-table min-w-[1220px]">
                <thead><tr>
                  <th><SortLink label="Дата" field="date" filters={filters} /></th>
                  <th><SortLink label="Номер" field="number" filters={filters} /></th>
                  <th><SortLink label="Канал" field="channel" filters={filters} /></th>
                  <th><SortLink label="Точка / касса" field="location" filters={filters} /></th>
                  <th>Сотрудник / клиент</th><th>Позиции</th>
                  <th><SortLink label="До скидки" field="total" filters={filters} /></th>
                  <th>Возврат</th><th><SortLink label="Итого" field="net" filters={filters} /></th>
                  <th>Оплата</th><th><SortLink label="Статус" field="status" filters={filters} /></th>
                </tr></thead>
                <tbody>{page.rows.map((sale) => (
                  <tr key={sale.saleId}>
                    <td><Link href={linkWith(filters, { sale: sale.saleId })} scroll={false}>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(sale.analyticsAt))}</Link></td>
                    <td><strong>{sale.number}</strong></td>
                    <td><span className="analytics-source-badge">{getChannelLabel(sale.channel)}</span></td>
                    <td><strong>{sale.location}</strong><span>{sale.terminal ?? "Без кассы"}</span></td>
                    <td>{sale.customer ?? sale.employee ?? "Не определён"}</td>
                    <td>{formatNumber(sale.itemsCount, 2)}</td>
                    <td>{formatRub(sale.grossAmount, 2)}</td>
                    <td>{sale.refundAmount ? formatRub(sale.refundAmount, 2) : "—"}</td>
                    <td><strong>{formatRub(sale.netRevenue, 2)}</strong></td>
                    <td>{getPaymentMethodLabel(sale.paymentMethod)}<span>{providerLabel(sale.paymentProvider)}</span></td>
                    <td><span className={`analytics-sale-status analytics-sale-status-${sale.status}`}>{getSaleStatusLabel(sale.status)}</span>{!sale.included ? <small>Не входит в выручку</small> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            <div className="analytics-sales-mobile">
              {page.rows.map((sale) => (
                <Link href={linkWith(filters, { sale: sale.saleId })} key={sale.saleId} className="analytics-sale-mobile-card" scroll={false}>
                  <div><span className="analytics-source-badge">{getChannelLabel(sale.channel)}</span><span>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(sale.analyticsAt))}</span></div>
                  <h2>{sale.channel === "pos_evotor" ? "Чек" : "Заказ"} {sale.number}</h2>
                  <p>{sale.location} · {sale.terminal ?? "Онлайн"} · {providerLabel(sale.paymentProvider)}</p>
                  <div><strong>{formatRub(sale.netRevenue, 2)}</strong><span>{getSaleStatusLabel(sale.status)}</span></div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="analytics-section-empty min-h-[240px]"><ReceiptText size={24} /><strong>Продажи не найдены</strong><span>Измените период, фильтры или поисковый запрос.</span></div>
        )}
      </section>

      <nav className="analytics-pagination" aria-label="Страницы журнала">
        <Link href={linkWith(filters, { page: String(Math.max(1, page.page - 1)) })} aria-disabled={page.page <= 1} className={page.page <= 1 ? "is-disabled" : ""}>Назад</Link>
        <span>Страница <strong>{page.page}</strong> из <strong>{page.pageCount}</strong></span>
        <div className="analytics-page-size" aria-label="Операций на странице">
          <span>Показывать</span>
          {[10, 25, 50, 100].map((size) => (
            <Link
              key={size}
              href={linkWith(filters, { pageSize: String(size), page: null })}
              className={page.pageSize === size ? "is-active" : ""}
              scroll={false}
            >
              {size}
            </Link>
          ))}
        </div>
        <Link href={linkWith(filters, { page: String(Math.min(page.pageCount, page.page + 1)) })} aria-disabled={page.page >= page.pageCount} className={page.page >= page.pageCount ? "is-disabled" : ""}>Дальше</Link>
      </nav>

      {page.detail ? <AnalyticsSaleDrawer detail={page.detail} closeHref={closeHref} /> : null}
    </main>
  );
}
