import {
  BadgeCheck,
  CalendarClock,
  ContactRound,
  HeartHandshake,
  MessageCircleMore,
  ScanLine,
  ShoppingBasket,
  Sparkles,
  UsersRound
} from "lucide-react";
import type { AudienceDashboard } from "@/lib/analytics/types";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";

function Metric({ label, value, hint, icon: Icon }: {
  label: string;
  value: string;
  hint: string;
  icon: typeof UsersRound;
}) {
  return (
    <article className="audience-metric">
      <span className="audience-metric-icon"><Icon size={19} /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>
    </article>
  );
}

function Bar({ value, tone = "orange" }: { value: number; tone?: "orange" | "green" | "ink" }) {
  return <span className={`audience-bar audience-bar-${tone}`} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(1, value))}%` }} /></span>;
}

export function AudienceAnalytics({ dashboard }: { dashboard: AudienceDashboard }) {
  const maxPreferenceRevenue = Math.max(1, ...dashboard.preferences.map((row) => row.revenue));
  return (
    <div className="audience-dashboard">
      <section className="audience-hero">
        <div>
          <span><Sparkles size={15} />Ядро аудитории</span>
          <h2>{dashboard.coreSummary}</h2>
          <p>Профиль строится по реальным заказам и способам входа. Предполагаемые пол, интересы и доход здесь не используются.</p>
        </div>
        <div className="audience-hero-coverage">
          <strong>{formatPercent(dashboard.identifiedCoveragePercent)}</strong>
          <span>продаж за период связаны с гостем</span>
          <small>{formatNumber(dashboard.identifiedSales)} из {formatNumber(dashboard.totalSales)} заказов</small>
        </div>
      </section>

      <section className="audience-metric-grid" aria-label="Показатели аудитории">
        <Metric icon={UsersRound} label="Гостей в базе" value={formatNumber(dashboard.customers)} hint={`${formatNumber(dashboard.activeCustomers)} покупали за период`} />
        <Metric icon={HeartHandshake} label="Повторные гости" value={formatPercent(dashboard.repeatRatePercent)} hint="сделали два заказа и больше" />
        <Metric icon={ShoppingBasket} label="Ценность гостя" value={formatRub(dashboard.averageLifetimeRevenue)} hint={`${formatNumber(dashboard.averageLifetimeOrders, 1)} заказа в среднем`} />
        <Metric icon={CalendarClock} label="Давность покупки" value={dashboard.medianRecencyDays === null ? "Нет данных" : `${formatNumber(dashboard.medianRecencyDays)} дн.`} hint="медиана по всей базе" />
      </section>

      <div className="audience-primary-grid">
        <section className="analytics-panel audience-segments">
          <header><div><span className="analytics-section-kicker">RFM-профиль</span><h2>Поведенческие сегменты</h2></div><small>На конец выбранного периода</small></header>
          <div className="audience-segment-list">
            {dashboard.segments.map((segment) => (
              <article key={segment.key} className={`audience-segment audience-segment-${segment.key}`}>
                <div><strong>{segment.label}</strong><span>{segment.description}</span></div>
                <div className="audience-segment-value"><strong>{formatNumber(segment.customers)}</strong><span>{formatPercent(segment.share)}</span></div>
                <Bar value={segment.share} tone={segment.key === "loyal" ? "green" : segment.key === "sleeping" ? "ink" : "orange"} />
                <div className="audience-segment-meta"><span>Выручка за историю <b>{formatRub(segment.revenue)}</b></span><span>Средний чек <b>{formatRub(segment.averageCheck)}</b></span></div>
              </article>
            ))}
          </div>
        </section>

        <section className="analytics-panel audience-frequency">
          <header><div><span className="analytics-section-kicker">Лояльность</span><h2>Частота заказов</h2></div></header>
          <div className="audience-frequency-list">
            {dashboard.frequencies.map((row) => (
              <div key={row.key}><div><strong>{row.label}</strong><span>{formatNumber(row.customers)} гостей</span></div><Bar value={row.share} tone="green" /><b>{formatPercent(row.share)}</b></div>
            ))}
          </div>
          <div className="audience-activation-grid">
            <div><ScanLine size={18} /><span>Карта гостя</span><strong>{formatPercent(dashboard.loyaltyCardCoveragePercent)}</strong><small>уже выпущена</small></div>
            <div><MessageCircleMore size={18} /><span>Можно уведомлять</span><strong>{formatPercent(dashboard.marketingReachPercent)}</strong><small>есть согласие</small></div>
          </div>
        </section>
      </div>

      <div className="audience-secondary-grid">
        <section className="analytics-panel audience-preferences">
          <header><div><span className="analytics-section-kicker">Выбранный период</span><h2>Что выбирают гости</h2></div><small>По идентифицированным заказам</small></header>
          {dashboard.preferences.length ? (
            <div className="audience-preference-list">
              {dashboard.preferences.map((row, index) => (
                <div key={row.key}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{row.name}</strong><Bar value={(row.revenue / maxPreferenceRevenue) * 100} /></div>
                  <div><strong>{formatRub(row.revenue)}</strong><small>{formatNumber(row.customers)} гостей · {formatPercent(row.share)}</small></div>
                </div>
              ))}
            </div>
          ) : <div className="analytics-section-empty"><ShoppingBasket size={23} /><strong>Пока нет предпочтений</strong><span>Нужны заказы, привязанные к гостям.</span></div>}
        </section>

        <section className="analytics-panel audience-identities">
          <header><div><span className="analytics-section-kicker">Доступность</span><h2>Как знаем гостей</h2></div></header>
          {dashboard.identities.length ? <div className="audience-identity-list">{dashboard.identities.map((row) => (
            <div key={row.provider}><span className={`audience-provider audience-provider-${row.provider}`}>{row.provider === "phone" ? <ContactRound size={18} /> : <BadgeCheck size={18} />}</span><div><strong>{row.label}</strong><span>{formatNumber(row.customers)} профилей</span></div><b>{formatPercent(row.share)}</b></div>
          ))}</div> : <div className="analytics-section-empty"><ContactRound size={23} /><strong>Нет связанных способов входа</strong></div>}

          <div className="audience-demography-note">
            <strong>Возраст: заполнено у {formatPercent(dashboard.ageCoveragePercent)}</strong>
            {dashboard.ageGroups.length ? <div>{dashboard.ageGroups.map((row) => <span key={row.key}>{row.label} <b>{formatPercent(row.share)}</b></span>)}</div> : <p>Разбивка появится после 10 заполненных дат рождения и только когда группы достаточно крупные. Пол и доход KARIMOFF не собирает.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
