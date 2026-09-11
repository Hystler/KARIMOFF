"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const links = [
  ["/admin/analytics", "Обзор"],
  ["/admin/analytics/sales", "Продажи"],
  ["/admin/analytics/audience", "Аудитория"],
  ["/admin/analytics/planning", "План закупок"]
] as const;

const overviewSections = [
  ["category-intelligence", "Категории"],
  ["hourly-demand", "Время и спрос"],
  ["products", "Товары"],
  ["basket-intelligence", "Корзины"],
  ["locations", "Точки"],
  ["employees", "Сотрудники"]
] as const;

const sharedFilterKeys = [
  "period", "from", "to", "compare", "channel", "location", "terminal", "employee",
  "payment", "provider", "category", "categories", "product", "weekday", "hourFrom", "hourTo"
] as const;

export function AnalyticsSubnav({ active }: { active: "overview" | "sales" | "audience" | "planning" }) {
  const searchParams = useSearchParams();
  const sharedParams = new URLSearchParams();
  for (const key of sharedFilterKeys) {
    for (const value of searchParams.getAll(key)) sharedParams.append(key, value);
  }
  const activeHref = active === "sales"
    ? "/admin/analytics/sales"
    : active === "planning"
      ? "/admin/analytics/planning"
    : active === "audience"
      ? "/admin/analytics/audience"
      : "/admin/analytics";
  return (
    <nav className="analytics-subnav" aria-label="Разделы аналитики">
      {links.map(([href, label]) => {
        const isActive = href === activeHref;
        // Planning uses its own history/horizon, not the reports' date and sales filters.
        const query = isActive ? searchParams.toString()
          : active === "planning" || href === "/admin/analytics/planning" ? "" : sharedParams.toString();
        return (
          <Link
            key={href}
            href={query ? `${href}?${query}` : href}
            className={isActive ? "is-active" : ""}
            aria-current={isActive ? "page" : undefined}
          >{label}</Link>
        );
      })}
    </nav>
  );
}

export function AnalyticsOverviewContents() {
  return (
    <nav aria-label="Содержание обзора" className="mb-5 border-b border-black/10 pb-3 text-sm">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {overviewSections.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="inline-block py-2 text-karimoff-muted underline decoration-black/20 underline-offset-4 hover:text-karimoff-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
