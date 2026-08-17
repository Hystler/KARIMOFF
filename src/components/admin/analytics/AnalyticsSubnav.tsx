import Link from "next/link";

const links = [
  ["/admin/analytics", "Обзор"],
  ["/admin/analytics/sales", "Продажи"],
  ["/admin/analytics#category-intelligence", "Категории"],
  ["/admin/analytics#hourly-demand", "Время и спрос"],
  ["/admin/analytics#products", "Товары"],
  ["/admin/analytics#basket-intelligence", "Корзины"],
  ["/admin/analytics#locations", "Точки"],
  ["/admin/analytics#employees", "Сотрудники"]
] as const;

export function AnalyticsSubnav({ active }: { active: "overview" | "sales" }) {
  return (
    <nav className="analytics-subnav" aria-label="Разделы аналитики">
      {links.map(([href, label], index) => (
        <Link key={href} href={href} className={(active === "overview" && index === 0) || (active === "sales" && index === 1) ? "is-active" : ""}>{label}</Link>
      ))}
    </nav>
  );
}
