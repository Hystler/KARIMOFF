import Link from "next/link";

const links = [
  ["/admin/analytics", "Обзор"],
  ["/admin/analytics/sales", "Продажи"],
  ["/admin/analytics/audience", "Аудитория"],
  ["/admin/analytics#category-intelligence", "Категории"],
  ["/admin/analytics#hourly-demand", "Время и спрос"],
  ["/admin/analytics#products", "Товары"],
  ["/admin/analytics#basket-intelligence", "Корзины"],
  ["/admin/analytics#locations", "Точки"],
  ["/admin/analytics#employees", "Сотрудники"]
] as const;

export function AnalyticsSubnav({ active }: { active: "overview" | "sales" | "audience" }) {
  const activeHref = active === "sales"
    ? "/admin/analytics/sales"
    : active === "audience"
      ? "/admin/analytics/audience"
      : "/admin/analytics";
  return (
    <nav className="analytics-subnav" aria-label="Разделы аналитики">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={href === activeHref ? "is-active" : ""}>{label}</Link>
      ))}
    </nav>
  );
}
