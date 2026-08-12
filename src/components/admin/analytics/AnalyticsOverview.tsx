import { ArrowDownRight, ArrowUpRight, Minus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { channelColors, getChannelLabel } from "@/lib/analytics/channels";
import { analyticsFiltersToParams } from "@/lib/analytics/filters";
import { getPaymentMethodLabel } from "@/lib/analytics/metrics";
import type {
  AnalyticsBreakdownRow,
  AnalyticsDashboard,
  AnalyticsFilters,
  AnalyticsMetric,
  KpiValue
} from "@/lib/analytics/types";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";
import { AnalyticsTrendChart } from "./AnalyticsTrendChart";

const metricTabs: Array<[AnalyticsMetric, string]> = [
  ["revenue", "Выручка"],
  ["sales", "Продажи"],
  ["average_check", "Средний чек"],
  ["items", "Товары"],
  ["refunds", "Возвраты"]
];

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function analyticsHref(filters: AnalyticsFilters, patch: Record<string, string | null>) {
  const params = analyticsFiltersToParams(filters);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) params.delete(key);
    else params.set(key, value);
  }
  return `/admin/analytics?${params.toString()}`;
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(1, max - min);
  const points = values.length
    ? values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${34 - ((value - min) / span) * 30}`).join(" ")
    : "0,34 100,34";
  return (
    <svg className="analytics-sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function Delta({ value, inverse = false }: { value: KpiValue; inverse?: boolean }) {
  const positive = value.delta.direction === "up" || value.delta.direction === "new";
  const negative = value.delta.direction === "down";
  const className = positive ? (inverse ? "is-negative" : "is-positive") : negative ? (inverse ? "is-positive" : "is-negative") : "is-neutral";
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  const text = value.delta.percent === null
    ? value.delta.direction === "new" ? "Новый результат" : "Нет базы сравнения"
    : `${value.delta.percent > 0 ? "+" : ""}${formatPercent(value.delta.percent)}`;
  return <span className={`analytics-kpi-delta ${className}`}><Icon size={14} />{text}</span>;
}

function KpiCard({
  label,
  value,
  format,
  inverse = false
}: {
  label: string;
  value: KpiValue;
  format: (value: number) => string;
  inverse?: boolean;
}) {
  return (
    <article className="analytics-kpi-card">
      <div>
        <span>{label}</span>
        <strong>{format(value.current)}</strong>
      </div>
      <Sparkline values={value.sparkline} />
      <div className="analytics-kpi-meta">
        <Delta value={value} inverse={inverse} />
        <span>было {format(value.previous)}</span>
      </div>
    </article>
  );
}

export function AnalyticsOverview({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const metricLabel = metricTabs.find(([value]) => value === dashboard.filters.metric)?.[1] ?? "Выручка";
  const maxHeat = Math.max(
    1,
    ...dashboard.heatmap.map((cell) => Math.abs(dashboard.filters.heatmapMetric === "sales" ? cell.sales : cell.revenue))
  );
  const maxWeekday = Math.max(1, ...dashboard.weekdays.map((row) => row.revenue));

  return (
    <>
      <section className="analytics-kpi-grid" aria-label="Основные показатели">
        <KpiCard label="Выручка" value={dashboard.kpis.revenue} format={(value) => formatRub(value)} />
        <KpiCard label="Продажи / чеки" value={dashboard.kpis.sales} format={(value) => formatNumber(value)} />
        <KpiCard label="Средний чек" value={dashboard.kpis.averageCheck} format={(value) => formatRub(value)} />
        <KpiCard label="Продано товаров" value={dashboard.kpis.items} format={(value) => formatNumber(value, 2)} />
        <KpiCard label="Возвраты" value={dashboard.kpis.refunds} format={(value) => formatRub(value)} inverse />
        {dashboard.kpis.discountsAvailable ? <KpiCard label="Скидки" value={dashboard.kpis.discounts} format={(value) => formatRub(value)} inverse /> : null}
        {dashboard.kpis.customersAvailable ? <KpiCard label="Известные клиенты" value={dashboard.kpis.customers} format={(value) => formatNumber(value)} /> : null}
      </section>

      <section className="analytics-panel analytics-main-chart">
        <header className="analytics-panel-heading">
          <div>
            <p className="admin-eyebrow">Динамика</p>
            <h2>{metricLabel}</h2>
            <span>{dashboard.range.label} · Москва</span>
          </div>
          <div className="analytics-chart-actions">
            <nav aria-label="Метрика графика">
              {metricTabs.map(([value, label]) => (
                <Link key={value} href={analyticsHref(dashboard.filters, { metric: value })} className={dashboard.filters.metric === value ? "is-active" : ""} scroll={false}>{label}</Link>
              ))}
            </nav>
            <Link
              href={analyticsHref(dashboard.filters, { breakdown: dashboard.filters.breakdown ? null : "channels" })}
              className={`analytics-breakdown-toggle ${dashboard.filters.breakdown ? "is-active" : ""}`}
              scroll={false}
            >
              По каналам
            </Link>
          </div>
        </header>
        <AnalyticsTrendChart data={dashboard.timeline} metric={dashboard.filters.metric} breakdown={dashboard.filters.breakdown} />
        <div className="analytics-chart-legend">
          {!dashboard.filters.breakdown ? (
            <><span><i className="bg-karimoff-orange" />Текущий период</span><span><i className="bg-[#AAA7A1]" />{dashboard.comparisonRange.label}</span></>
          ) : dashboard.revenueMix.map((row) => (
            <span key={row.channel}><i style={{ background: channelColors[row.channel] }} />{getChannelLabel(row.channel)}</span>
          ))}
        </div>
      </section>

      <div className="analytics-two-column">
        <section className="analytics-panel">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Каналы</p><h2>Структура выручки</h2></div>
          </header>
          {dashboard.revenueMix.length ? (
            <>
              <div className="analytics-mix-bar" aria-label="Доли каналов">
                {dashboard.revenueMix.map((row) => <span key={row.channel} style={{ width: `${row.share}%`, background: channelColors[row.channel] }} />)}
              </div>
              <div className="analytics-mix-list">
                {dashboard.revenueMix.map((row) => (
                  <div key={row.channel}>
                    <i style={{ background: channelColors[row.channel] }} />
                    <span><strong>{getChannelLabel(row.channel)}</strong><small>{formatNumber(row.sales)} продаж</small></span>
                    <strong>{formatRub(row.revenue)}</strong>
                    <em>{formatPercent(row.share)}</em>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState text="За период нет выручки для распределения." />}
        </section>

        <section className="analytics-panel" id="payments">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Оплата</p><h2>Способы оплаты</h2></div>
          </header>
          <CompactBreakdown rows={dashboard.payments.map((row) => ({ ...row, name: getPaymentMethodLabel(row.method) }))} />
        </section>
      </div>

      <section className="analytics-panel" id="heatmap">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Ритм точки</p><h2>День недели × час</h2><span>Локальное время ресторана</span></div>
          <nav className="analytics-mini-tabs" aria-label="Метрика тепловой карты">
            <Link href={analyticsHref(dashboard.filters, { heatmap: null })} className={dashboard.filters.heatmapMetric === "revenue" ? "is-active" : ""} scroll={false}>Выручка</Link>
            <Link href={analyticsHref(dashboard.filters, { heatmap: "sales" })} className={dashboard.filters.heatmapMetric === "sales" ? "is-active" : ""} scroll={false}>Продажи</Link>
          </nav>
        </header>
        <div className="analytics-heatmap-scroll">
          <div className="analytics-heatmap" role="grid" aria-label="Продажи по дням недели и часам">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="analytics-heatmap-hour">{hour}</span>)}
            {Array.from({ length: 7 }, (_, index) => index + 1).map((weekday) => (
              <div className="contents" key={weekday}>
                <strong>{weekdays[weekday - 1]}</strong>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cell = dashboard.heatmap.find((item) => item.weekday === weekday && item.hour === hour);
                  const value = dashboard.filters.heatmapMetric === "sales" ? cell?.sales ?? 0 : cell?.revenue ?? 0;
                  const intensity = Math.abs(value) / maxHeat;
                  const label = dashboard.filters.heatmapMetric === "sales" ? `${formatNumber(value)} продаж` : formatRub(value);
                  const color = value < 0 ? "220, 38, 38" : "251, 103, 10";
                  return <span key={hour} role="gridcell" tabIndex={0} title={`${weekdays[weekday - 1]}, ${hour}:00 — ${label}`} style={{ backgroundColor: `rgba(${color}, ${0.05 + intensity * 0.9})` }} />;
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="analytics-panel">
        <header className="analytics-panel-heading compact">
          <div><p className="admin-eyebrow">Неделя</p><h2>Продажи по дням недели</h2></div>
        </header>
        <div className="analytics-weekdays">
          {dashboard.weekdays.map((row) => (
            <article key={row.weekday}>
              <div><strong>{weekdays[row.weekday - 1]}</strong><span>{formatNumber(row.sales)} чеков</span></div>
              <div className="analytics-weekday-bar"><span style={{ width: `${(Math.max(0, row.revenue) / maxWeekday) * 100}%` }} /></div>
              <strong>{formatRub(row.revenue)}</strong>
              <small>Средний {formatRub(row.averageCheck)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="analytics-panel" id="products">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Ассортимент</p><h2>Товары</h2><span>POS без подтверждённого mapping остаётся видимым</span></div>
          <nav className="analytics-mini-tabs" aria-label="Рейтинг товаров">
            {[["revenue", "По выручке"], ["quantity", "По количеству"], ["growth", "Рост"], ["decline", "Падение"]].map(([value, label]) => (
              <Link key={value} href={analyticsHref(dashboard.filters, { ranking: value === "revenue" ? null : value })} className={dashboard.filters.productRanking === value ? "is-active" : ""} scroll={false}>{label}</Link>
            ))}
          </nav>
        </header>
        {dashboard.products.length ? (
          <div className="overflow-x-auto">
            <table className="analytics-table min-w-[860px]">
              <thead><tr><th>Товар</th><th>Канал</th><th>Продано</th><th>Выручка</th><th>Средняя цена</th><th>Доля</th><th>Динамика</th></tr></thead>
              <tbody>{dashboard.products.map((product) => (
                <tr key={product.key}>
                  <td><strong>{product.name}</strong><span>{product.category ?? "Категория не указана"}</span>{product.mappingStatus === "unmapped" ? <em>Не сопоставлено</em> : null}</td>
                  <td>{product.channel === "multiple" ? "Несколько" : getChannelLabel(product.channel)}</td>
                  <td>{formatNumber(product.quantity, 2)}</td>
                  <td><strong>{formatRub(product.revenue)}</strong></td>
                  <td>{formatRub(product.averagePrice)}</td>
                  <td>{formatPercent(product.share)}</td>
                  <td><Delta value={{ current: product.revenue, previous: product.previousRevenue, delta: product.delta, sparkline: [] }} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState text="В выбранном периоде нет товарных позиций." />}
      </section>

      <div className="analytics-two-column" id="locations">
        <section className="analytics-panel"><header className="analytics-panel-heading compact"><div><p className="admin-eyebrow">Сеть</p><h2>По точкам</h2></div></header><CompactBreakdown rows={dashboard.locations} /></section>
        <section className="analytics-panel"><header className="analytics-panel-heading compact"><div><p className="admin-eyebrow">Оборудование</p><h2>По кассам</h2></div></header><CompactBreakdown rows={dashboard.terminals} /></section>
      </div>

      <div className="analytics-two-column" id="employees">
        <section className="analytics-panel"><header className="analytics-panel-heading compact"><div><p className="admin-eyebrow">Команда</p><h2>Продажи по сотрудникам</h2></div></header><CompactBreakdown rows={dashboard.employees} showItems /></section>
        <section className="analytics-panel"><header className="analytics-panel-heading compact"><div><p className="admin-eyebrow">Категории</p><h2>Структура ассортимента</h2></div></header><CompactBreakdown rows={dashboard.categories} /></section>
      </div>
    </>
  );
}

function CompactBreakdown({ rows, showItems = false }: { rows: AnalyticsBreakdownRow[]; showItems?: boolean }) {
  if (!rows.length) return <EmptyState text="Для этого среза пока нет данных." />;
  return (
    <div className="analytics-breakdown-list">
      {rows.slice(0, 8).map((row) => (
        <div key={row.id}>
          <div><strong>{row.name}</strong><span>{formatNumber(row.sales)} чеков · средний {formatRub(row.averageCheck)}{showItems ? ` · ${formatNumber(row.itemsPerCheck, 1)} поз./чек` : ""}</span></div>
          <div><strong>{formatRub(row.revenue)}</strong><span>{formatPercent(row.share)}</span></div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="analytics-section-empty"><ReceiptText size={21} /><span>{text}</span></div>;
}
