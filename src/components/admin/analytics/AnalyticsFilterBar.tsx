"use client";

import { CalendarDays, Check, Filter, LoaderCircle, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { channelLabels } from "@/lib/analytics/channels";
import { analyticsFiltersToParams } from "@/lib/analytics/filters";
import { paymentMethodLabels } from "@/lib/analytics/metrics";
import type { AnalyticsFilterOptions, AnalyticsFilters } from "@/lib/analytics/types";

const periods = [
  ["today", "Сегодня"],
  ["yesterday", "Вчера"],
  ["7d", "7 дней"],
  ["30d", "30 дней"],
  ["this_week", "Эта неделя"],
  ["last_week", "Прошлая неделя"],
  ["this_month", "Этот месяц"],
  ["last_month", "Прошлый месяц"],
  ["this_quarter", "Этот квартал"],
  ["custom", "Свой период"]
] as const;

const comparisons = [
  ["previous_period", "Аналогичный период"],
  ["previous_week", "Предыдущая неделя"],
  ["previous_month", "Предыдущий месяц"],
  ["previous_year", "Предыдущий год"]
] as const;

type Props = {
  filters: AnalyticsFilters;
  options: AnalyticsFilterOptions;
  showSearch?: boolean;
};

export function AnalyticsFilterBar({ filters, options, showSearch = false }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dateFrom, setDateFrom] = useState(filters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(filters.dateTo ?? "");
  const [search, setSearch] = useState(filters.search);
  const filtersRef = useRef<HTMLDetailsElement>(null);

  const navigate = (patch: Record<string, string | null>) => {
    if (filtersRef.current?.open) filtersRef.current.open = false;
    const params = analyticsFiltersToParams(filters);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const hasDetailedFilters = Boolean(
    filters.location || filters.terminal || filters.employee || filters.payment || filters.category || filters.product
  );
  const visibleComparisons = comparisons.filter(
    ([value]) => value !== "previous_year" || options.hasPreviousYear || filters.comparison === "previous_year"
  );

  return (
    <div className="analytics-filter-shell">
      <div className="analytics-channel-row" aria-label="Канал продаж">
        <button
          type="button"
          aria-pressed={filters.channel === "all"}
          className={filters.channel === "all" ? "is-active" : ""}
          onClick={() => navigate({ channel: "all" })}
        >
          Все продажи
        </button>
        {options.channels.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={filters.channel === option.value}
            className={filters.channel === option.value ? "is-active" : ""}
            onClick={() => navigate({ channel: option.value })}
          >
            {channelLabels[option.value as keyof typeof channelLabels] ?? option.label}
          </button>
        ))}
      </div>

      <div className="analytics-filter-main">
        <label className="analytics-select-control">
          <CalendarDays size={17} />
          <span className="sr-only">Период</span>
          <select
            value={filters.period}
            onChange={(event) =>
              navigate({
                period: event.target.value,
                from: event.target.value === "custom" ? filters.dateFrom : null,
                to: event.target.value === "custom" ? filters.dateTo : null
              })
            }
          >
            {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="analytics-select-control">
          <span className="text-[11px] font-black uppercase text-karimoff-muted">Сравнить</span>
          <select value={filters.comparison} onChange={(event) => navigate({ compare: event.target.value })}>
            {visibleComparisons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        {filters.period === "custom" ? (
          <div className="analytics-custom-range">
            <label>
              <span>С</span>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              <span>По</span>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <button
              type="button"
              aria-label="Применить период"
              onClick={() => navigate({ from: dateFrom, to: dateTo })}
              disabled={!dateFrom || !dateTo || dateFrom > dateTo}
            >
              <Check size={17} />
            </button>
          </div>
        ) : null}

        <details className="analytics-more-filters" ref={filtersRef}>
          <summary>
            <Filter size={17} />
            Фильтры
            {hasDetailedFilters ? <span className="analytics-filter-dot" /> : null}
          </summary>
          <div className="analytics-filter-popover">
            <div className="analytics-filter-sheet-heading">
              <strong>Фильтры</strong>
              <button type="button" aria-label="Закрыть фильтры" onClick={() => filtersRef.current?.removeAttribute("open")}><X size={19} /></button>
            </div>
            <FilterSelect label="Точка" value={filters.location} options={options.locations} onChange={(value) => navigate({ location: value, terminal: null })} />
            <FilterSelect label="Касса" value={filters.terminal} options={options.terminals} onChange={(value) => navigate({ terminal: value })} />
            <FilterSelect label="Сотрудник" value={filters.employee} options={options.employees} onChange={(value) => navigate({ employee: value })} />
            <FilterSelect
              label="Способ оплаты"
              value={filters.payment}
              options={options.payments.map((item) => ({ ...item, label: paymentMethodLabels[item.value] ?? "Не определено" }))}
              onChange={(value) => navigate({ payment: value })}
            />
            <FilterSelect label="Категория" value={filters.category} options={options.categories} onChange={(value) => navigate({ category: value })} />
            <FilterSelect label="Товар" value={filters.product} options={options.products} onChange={(value) => navigate({ product: value })} />
            {hasDetailedFilters ? (
              <button
                type="button"
                className="analytics-reset-button"
                onClick={() => navigate({ location: null, terminal: null, employee: null, payment: null, category: null, product: null })}
              >
                <RotateCcw size={16} />
                Сбросить фильтры
              </button>
            ) : null}
          </div>
        </details>

        {showSearch ? (
          <form
            className="analytics-search"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ search });
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Чек, заказ, товар, сотрудник"
              aria-label="Поиск по продажам"
            />
            <button type="submit">Найти</button>
          </form>
        ) : null}

        {pending ? (
          <span className="analytics-filter-loading" role="status">
            <LoaderCircle size={17} className="animate-spin" />
            Обновляем
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string | null;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Все</option>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
