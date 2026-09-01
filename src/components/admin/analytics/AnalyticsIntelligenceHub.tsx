import { ArrowRight, Download, Info, Layers3, PackageSearch, ReceiptText, ShoppingBasket, Sparkles } from "lucide-react";
import Link from "next/link";
import { analyticsFiltersToParams } from "@/lib/analytics/filters";
import {
  formatOperatingInterval,
  OPERATING_INTERVALS,
  RESTAURANT_CLOSE_HOUR,
  RESTAURANT_OPEN_HOUR
} from "@/lib/analytics/operating-hours";
import type { AnalyticsDashboard, AnalyticsFilters, KpiValue } from "@/lib/analytics/types";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";
import { AnalyticsFullscreenButton } from "./AnalyticsFullscreenButton";

const chartColors = ["#FB670A", "#151515", "#23856D", "#3267A8", "#B34E37"];
const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function analyticsHref(filters: AnalyticsFilters, patch: Record<string, string | null>, path = "/admin/analytics") {
  const params = analyticsFiltersToParams(filters);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "category") params.delete("category");
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  params.delete("page");
  return `${path}?${params.toString()}`;
}

function MiniSparkline({ values }: { values: number[] }) {
  const safe = values.length ? values : [0, 0];
  const minimum = Math.min(0, ...safe);
  const maximum = Math.max(1, ...safe);
  const span = maximum - minimum || 1;
  const points = safe.map((value, index) => `${(index / Math.max(1, safe.length - 1)) * 100},${30 - ((value - minimum) / span) * 27}`).join(" ");
  return <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function DeltaText({ value }: { value: { percent: number | null; direction: string } }) {
  if (value.percent === null) return <span className="is-neutral">нет продаж в прошлом периоде</span>;
  return (
    <span className={value.direction === "up" ? "is-positive" : value.direction === "down" ? "is-negative" : "is-neutral"}>
      {value.percent > 0 ? "+" : ""}{formatPercent(value.percent)}
    </span>
  );
}

export function AnalyticsIntelligenceHub({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const intelligence = dashboard.intelligence;
  return (
    <>
      {intelligence.insights.length ? (
        <section className="analytics-insight-strip" aria-labelledby="analytics-insights-heading">
          <header>
            <Sparkles size={18} />
            <div><p className="admin-eyebrow">Без догадок</p><h2 id="analytics-insights-heading">Что изменилось</h2></div>
          </header>
          <div>
            {intelligence.insights.map((insight) => (
              <Link href={insight.href} key={insight.id} className={`is-${insight.tone}`} scroll={false}>
                <strong>{insight.title}</strong><span>{insight.detail}</span><ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="analytics-panel" id="category-intelligence">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Структура продаж</p><h2>Категории</h2><span>Нажатие применяет категорию ко всему отчёту</span></div>
          <div className="analytics-heading-tools">
            {dashboard.itemFiltered ? <span className="analytics-context-badge">Позиционный срез</span> : null}
            <Link className="analytics-export-link" href={`/api/admin/analytics/report/export?report=categories&${analyticsFiltersToParams(dashboard.filters).toString()}`}><Download size={15} />CSV</Link>
          </div>
        </header>
        {intelligence.categoryCards.length ? (
          <div className="analytics-category-grid">
            {intelligence.categoryCards.slice(0, 10).map((category) => (
              <Link
                key={category.id}
                href={analyticsHref(dashboard.filters, { category: category.id === "__unknown__" ? null : category.id })}
                className={dashboard.filters.categories.includes(category.id) ? "is-active" : ""}
                scroll={false}
              >
                <div><strong>{category.name}</strong><DeltaText value={category.delta} /></div>
                <b>{formatRub(category.revenue)}</b>
                <MiniSparkline values={category.sparkline} />
                <dl>
                  <div><dt>Продано</dt><dd>{formatNumber(category.quantity, 2)}</dd></div>
                  <div><dt>Чеков</dt><dd>{formatNumber(category.receipts)}</dd></div>
                  <div><dt>Средняя цена</dt><dd>{formatRub(category.averageItemPrice)}</dd></div>
                  <div><dt>Доля</dt><dd>{formatPercent(category.share)}</dd></div>
                </dl>
              </Link>
            ))}
          </div>
        ) : <AnalyticsEmpty text="Категории появятся после сопоставления товаров или продаж web-каталога." />}
      </section>

      {intelligence.productProfile ? <ProductProfile dashboard={dashboard} /> : null}

      <div className="analytics-two-column analytics-intelligence-columns">
        <section className="analytics-panel" id="average-ticket-decomposition">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Декомпозиция</p><h2>Из чего складывается чек</h2></div>
          </header>
          <div className="analytics-factor-grid">
            <Factor label="Позиций в чеке" value={intelligence.averageTicketFactors.itemsPerReceipt} format={(value) => formatNumber(value, 2)} />
            <span className="analytics-factor-sign">×</span>
            <Factor label="Средняя цена позиции" value={intelligence.averageTicketFactors.averageItemValue} format={formatRub} />
          </div>
          <p className="analytics-method-note"><Info size={14} />Рост среднего чека разделён на количество позиций и их среднюю стоимость, без причинных предположений.</p>
        </section>
        <section className="analytics-panel" id="revenue-decomposition">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Период к периоду</p><h2>Изменение выручки</h2></div>
          </header>
          <div className="analytics-bridge">
            <BridgeRow label="Предыдущая выручка" value={intelligence.revenueBridge.previous} />
            <BridgeRow label="Изменение числа чеков" value={intelligence.revenueBridge.receiptEffect} delta />
            <BridgeRow label="Изменение среднего чека" value={intelligence.revenueBridge.ticketEffect} delta />
            <BridgeRow label="Изменение возвратов" value={intelligence.revenueBridge.refundChange} delta />
            <BridgeRow label="Текущая выручка" value={intelligence.revenueBridge.current} strong />
          </div>
        </section>
      </div>

      <section className="analytics-panel analytics-expanded-panel" id="hourly-demand">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Время и спрос</p><h2>Категории по рабочим интервалам</h2><span>11:00–21:00 · до пяти ведущих или выбранных категорий · Москва</span></div>
          <div className="analytics-heading-tools">
            <nav className="analytics-mini-tabs" aria-label="Метрика почасового спроса">
              <Link href={analyticsHref(dashboard.filters, { demand: null })} className={dashboard.filters.demandMetric === "revenue" ? "is-active" : ""} scroll={false}>Выручка</Link>
              <Link href={analyticsHref(dashboard.filters, { demand: "items" })} className={dashboard.filters.demandMetric === "items" ? "is-active" : ""} scroll={false}>Количество</Link>
            </nav>
            <AnalyticsFullscreenButton targetId="hourly-demand" />
          </div>
        </header>
        <HourlyDemandChart dashboard={dashboard} />
      </section>

      <div className="analytics-two-column analytics-intelligence-columns">
        <section className="analytics-panel" id="calendar-demand">
          <header className="analytics-panel-heading">
            <div><p className="admin-eyebrow">Календарь</p><h2>Сильные и слабые дни</h2></div>
            <nav className="analytics-mini-tabs" aria-label="Метрика календаря">
              <Link href={analyticsHref(dashboard.filters, { calendar: null })} className={dashboard.filters.calendarMetric === "revenue" ? "is-active" : ""} scroll={false}>Выручка</Link>
              <Link href={analyticsHref(dashboard.filters, { calendar: "sales" })} className={dashboard.filters.calendarMetric === "sales" ? "is-active" : ""} scroll={false}>Чеки</Link>
              <Link href={analyticsHref(dashboard.filters, { calendar: "average_check" })} className={dashboard.filters.calendarMetric === "average_check" ? "is-active" : ""} scroll={false}>Средний чек</Link>
            </nav>
          </header>
          <CalendarHeatmap dashboard={dashboard} />
        </section>
        <section className="analytics-panel" id="dayparts">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Части дня</p><h2>Спрос по рабочему времени</h2><span>Только интервалы работы точки · Москва</span></div>
          </header>
          <div className="analytics-dayparts">
            {intelligence.dayparts.map((part) => (
              <Link href={analyticsHref(dashboard.filters, { hourFrom: part.hours.slice(0, 2), hourTo: part.hours.slice(6, 8) })} key={part.key} scroll={false}>
                <div><strong>{part.label}</strong><span>{part.hours}</span></div>
                <strong>{formatRub(part.revenue)}</strong>
                <span>{formatNumber(part.receipts)} чеков · {formatNumber(part.quantity, 1)} позиций</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="analytics-panel analytics-expanded-panel" id="sales-treemap">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Ассортимент на одном экране</p><h2>Карта продаж</h2><span>Категория → товар; размер отражает выбранную метрику</span></div>
          <div className="analytics-heading-tools">
            <nav className="analytics-mini-tabs" aria-label="Метрика карты продаж">
              <Link href={analyticsHref(dashboard.filters, { treemap: null })} className={dashboard.filters.treemapMetric === "revenue" ? "is-active" : ""} scroll={false}>Выручка</Link>
              <Link href={analyticsHref(dashboard.filters, { treemap: "items" })} className={dashboard.filters.treemapMetric === "items" ? "is-active" : ""} scroll={false}>Количество</Link>
            </nav>
            <Link className="analytics-export-link" href={`/api/admin/analytics/report/export?report=products&${analyticsFiltersToParams(dashboard.filters).toString()}`}><Download size={15} />CSV</Link>
            <AnalyticsFullscreenButton targetId="sales-treemap" />
          </div>
        </header>
        <SalesTreemap dashboard={dashboard} />
      </section>

      <div className="analytics-two-column analytics-intelligence-columns">
        <section className="analytics-panel" id="pareto">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Pareto / ABC</p><h2>Концентрация выручки</h2></div>
          </header>
          <ParetoPanel dashboard={dashboard} />
        </section>
        <section className="analytics-panel" id="basket-sizes">
          <header className="analytics-panel-heading compact">
            <div><p className="admin-eyebrow">Размер корзины</p><h2>Сколько позиций покупают</h2></div>
          </header>
          <BasketSizePanel dashboard={dashboard} />
        </section>
      </div>

      <section className="analytics-panel" id="basket-intelligence">
        <header className="analytics-panel-heading">
          <div><p className="admin-eyebrow">Корзинная аналитика</p><h2>Часто покупают вместе</h2><span>Только пары минимум из двух чеков; это наблюдение, не причинная рекомендация</span></div>
        </header>
        {intelligence.basketPairs.length ? (
          <div className="analytics-pair-grid">
            {intelligence.basketPairs.map((pair) => (
              <article key={`${pair.leftKey}:${pair.rightKey}`}>
                <ShoppingBasket size={18} />
                <div><strong>{pair.leftName}</strong><span>+</span><strong>{pair.rightName}</strong></div>
                <dl>
                  <div><dt>Совместных чеков</dt><dd>{formatNumber(pair.baskets)}</dd></div>
                  <div title="Доля всех чеков, в которых встретились оба товара"><dt>Доля чеков</dt><dd>{formatPercent(pair.support)}</dd></div>
                  <div title="Более сильная из двух условных долей: A при B или B при A"><dt>Связь пары</dt><dd>{formatPercent(pair.confidence)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : <AnalyticsEmpty text="Для устойчивых пар пока недостаточно повторяющихся чеков." />}
      </section>
    </>
  );
}

function Factor({ label, value, format }: { label: string; value: KpiValue; format: (value: number) => string }) {
  return <article><span>{label}</span><strong>{format(value.current)}</strong><DeltaText value={value.delta} /><small>было {format(value.previous)}</small></article>;
}

function BridgeRow({ label, value, delta = false, strong = false }: { label: string; value: number; delta?: boolean; strong?: boolean }) {
  return <div className={strong ? "is-total" : ""}><span>{label}</span><strong className={delta ? value >= 0 ? "is-positive" : "is-negative" : ""}>{delta && value > 0 ? "+" : ""}{formatRub(value)}</strong></div>;
}

function ProductProfile({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const profile = dashboard.intelligence.productProfile;
  if (!profile) return null;
  return (
    <section className="analytics-product-profile">
      <div><PackageSearch size={22} /><span>Профиль товара</span><h2>{profile.name}</h2><p>{profile.category ?? "Категория не сопоставлена"}</p></div>
      <dl>
        <div><dt>Выручка</dt><dd>{formatRub(profile.revenue)}</dd></div>
        <div><dt>Количество</dt><dd>{formatNumber(profile.quantity, 2)}</dd></div>
        <div><dt>Дней с продажами</dt><dd>{formatNumber(profile.daysSold)}</dd></div>
        <div><dt>В среднем в день</dt><dd>{formatNumber(profile.averageUnitsPerDay, 2)}</dd></div>
        <div><dt>Пиковый интервал</dt><dd>{profile.peakHour === null ? "Нет данных" : formatOperatingInterval(profile.peakHour)}</dd></div>
        <div><dt>Сильный день</dt><dd>{profile.strongestWeekday ? weekdayLabels[profile.strongestWeekday - 1] : "Нет данных"}</dd></div>
        <div><dt>Доля категории</dt><dd>{profile.categoryShare === null ? "Нет mapping" : formatPercent(profile.categoryShare)}</dd></div>
      </dl>
    </section>
  );
}

function HourlyDemandChart({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const data = dashboard.intelligence.hourlyDemand;
  const categories = Object.keys(data[0]?.categories ?? {});
  if (!categories.length) return <AnalyticsEmpty text="Нет категорий для почасового сравнения." />;
  const metric = dashboard.filters.demandMetric;
  const values = data.flatMap((point) => categories.map((category) => metric === "items" ? point.categories[category]?.quantity ?? 0 : point.categories[category]?.revenue ?? 0));
  const maximum = Math.max(1, ...values);
  const intervalSpan = RESTAURANT_CLOSE_HOUR - RESTAURANT_OPEN_HOUR - 1;
  const x = (hour: number) => 48 + ((hour - RESTAURANT_OPEN_HOUR) / intervalSpan) * 820;
  const y = (value: number) => 258 - (Math.max(0, value) / maximum) * 218;
  return (
    <div className="analytics-demand-chart">
      <svg viewBox="0 0 900 300" role="img" aria-label="Почасовой спрос по категориям">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1="48" x2="868" y1={y(maximum * ratio)} y2={y(maximum * ratio)} />)}
        {categories.map((category, index) => {
          const points = data.map((point) => `${x(point.hour)},${y(metric === "items" ? point.categories[category]?.quantity ?? 0 : point.categories[category]?.revenue ?? 0)}`).join(" ");
          return <polyline key={category} points={points} style={{ stroke: chartColors[index % chartColors.length] }} />;
        })}
        {OPERATING_INTERVALS.map(({ hour, label }) => <text x={x(hour)} y="286" textAnchor="middle" key={hour}>{label}</text>)}
        {categories.flatMap((category, categoryIndex) => data.map((point) => {
          const value = metric === "items" ? point.categories[category]?.quantity ?? 0 : point.categories[category]?.revenue ?? 0;
          if (!value) return null;
          const href = analyticsHref(dashboard.filters, { hourFrom: String(point.hour), hourTo: String(point.hour + 1), category }, "/admin/analytics/sales");
          const categoryPoint = point.categories[category];
          return <a href={href} key={`${category}:${point.hour}`}><circle cx={x(point.hour)} cy={y(value)} r="5" style={{ fill: chartColors[categoryIndex % chartColors.length] }}><title>{category}, {formatOperatingInterval(point.hour)} — выручка {formatRub(categoryPoint?.revenue ?? 0)}, товаров {formatNumber(categoryPoint?.quantity ?? 0, 2)}, чеков {formatNumber(categoryPoint?.receipts ?? 0)}</title></circle></a>;
        }))}
      </svg>
      <div className="analytics-demand-legend">{categories.map((category, index) => <span key={category}><i style={{ background: chartColors[index % chartColors.length] }} />{category}</span>)}</div>
    </div>
  );
}

function CalendarHeatmap({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const rows = dashboard.intelligence.calendar;
  if (!rows.length) return <AnalyticsEmpty text="В выбранном периоде нет дней с продажами." />;
  const metric = dashboard.filters.calendarMetric;
  const value = (row: (typeof rows)[number]) => metric === "sales" ? row.receipts : metric === "average_check" ? row.averageCheck : row.revenue;
  const maximum = Math.max(1, ...rows.map(value));
  const firstWeekday = (() => { const day = new Date(`${rows[0].date}T12:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; })();
  return (
    <div className="analytics-calendar-wrap">
      <div className="analytics-calendar-head">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="analytics-calendar-grid">
        {Array.from({ length: firstWeekday - 1 }, (_, index) => <span key={`empty-${index}`} />)}
        {rows.map((row) => {
          const current = value(row);
          const label = metric === "sales" ? `${formatNumber(current)} чеков` : formatRub(current);
          return (
            <Link
              key={row.date}
              href={analyticsHref(dashboard.filters, { period: "custom", from: row.date, to: row.date }, "/admin/analytics/sales")}
              style={{ background: `rgba(251,103,10,${0.06 + (Math.max(0, current) / maximum) * 0.88})` }}
              title={`${row.date}: выручка ${formatRub(row.revenue)}, чеков ${formatNumber(row.receipts)}, средний чек ${formatRub(row.averageCheck)}`}
            >
              <strong>{Number(row.date.slice(-2))}</strong><span>{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SalesTreemap({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const rows = dashboard.intelligence.treemap;
  if (!rows.length) return <AnalyticsEmpty text="Нет товарных данных для карты продаж." />;
  const metric = dashboard.filters.treemapMetric;
  const total = rows.reduce((sum, row) => sum + Math.max(0, metric === "items" ? row.quantity : row.revenue), 0);
  return (
    <div className="analytics-treemap">
      {rows.filter((row) => (metric === "items" ? row.quantity : row.revenue) > 0).map((row, index) => {
        const current = metric === "items" ? row.quantity : row.revenue;
        const share = total > 0 ? (current / total) * 100 : 0;
        return (
          <Link
            key={row.key}
            href={analyticsHref(dashboard.filters, { product: row.key })}
            style={{ flexBasis: `${Math.max(12, Math.min(42, share * 2.1))}%`, background: index % 5 === 0 ? "#171717" : index % 3 === 0 ? "#E85F0A" : "#F5F1EB", color: index % 5 === 0 || index % 3 === 0 ? "white" : "#171717" }}
            scroll={false}
          >
            <span>{row.category}</span><strong>{row.name}</strong><b>{metric === "items" ? formatNumber(row.quantity, 2) : formatRub(row.revenue)}</b><small>{formatPercent(share)}{row.mappingStatus === "unmapped" ? " · Не сопоставлено" : ""}</small>
          </Link>
        );
      })}
    </div>
  );
}

function ParetoPanel({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const pareto = dashboard.intelligence.pareto;
  if (!pareto.rows.length) return <AnalyticsEmpty text="Нет положительной выручки для Pareto-анализа." />;
  return (
    <div className="analytics-pareto">
      <div className="analytics-pareto-summary">
        <div><span>50% выручки</span><strong>{pareto.productsTo50}</strong><small>товаров</small></div>
        <div><span>80% выручки</span><strong>{pareto.productsTo80}</strong><small>товаров</small></div>
        <div><span>90% выручки</span><strong>{pareto.productsTo90}</strong><small>товаров</small></div>
      </div>
      <div className="analytics-pareto-list">
        {pareto.rows.slice(0, 12).map((row) => (
          <div key={row.key}><span className={`abc-${row.abc}`}>{row.abc}</span><strong>{row.name}</strong><div><i style={{ width: `${Math.min(100, row.cumulativeShare)}%` }} /></div><em>{formatPercent(row.cumulativeShare)}</em></div>
        ))}
      </div>
      <p className="analytics-method-note"><Layers3 size={14} />A: до 80% накопленной выручки, B: до 95%, C: оставшийся хвост. Каталог автоматически не меняется.</p>
    </div>
  );
}

function BasketSizePanel({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const rows = dashboard.intelligence.basketSizes;
  const maxReceipts = Math.max(1, ...rows.map((row) => row.receipts));
  return (
    <div className="analytics-basket-size">
      {rows.map((row) => (
        <div key={row.bucket}><strong>{row.bucket} {row.bucket === "1" ? "позиция" : "позиции"}</strong><div><i style={{ width: `${(row.receipts / maxReceipts) * 100}%` }} /></div><span>{formatNumber(row.receipts)} чеков</span><b>{formatRub(row.averageRevenue)} / чек</b></div>
      ))}
    </div>
  );
}

function AnalyticsEmpty({ text }: { text: string }) {
  return <div className="analytics-section-empty"><ReceiptText size={21} /><span>{text}</span></div>;
}
