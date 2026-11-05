import Link from "next/link";
import { getAdminDailySales, getAdminOverviewSnapshot } from "@/lib/admin-overview";
import { getAnalyticsScope } from "@/lib/analytics/permissions";

export async function RustamOverview() {
  const scope = await getAnalyticsScope();
  const [overview, sales] = await Promise.all([getAdminOverviewSnapshot(), getAdminDailySales(scope)]);
  const snapshot = overview.snapshot;
  const number = new Intl.NumberFormat("ru-RU");
  const modules = [
    ["/admin/products", "Меню и food cost", "Позиции, цены и состав блюд"],
    ["/admin/ingredients", "Ингредиенты", "Закупочные цены и карточки"],
    ["/admin/ingredients/extras", "Допы к блюдам", "Состав и цены дополнений"],
    ["/admin/inventory", "Склад", "Остатки, приходы и расход"],
    ["/admin/analytics/planning", "План закупок", "Спрос и потребность в товарах"],
    ["/admin/production", "Производство", "Технологические карты и выпуски"],
    ["/admin/economics", "Экономика", "Затраты и себестоимость"],
    ["/admin/analytics", "Аналитика", "Продажи, финансы и спрос"],
    ["/admin/integrations/evotor", "Эвотор", "Подключение кассы и импорт продаж"]
  ];
  return <main className="admin-content admin-overview-dashboard">
    <header className="admin-heading"><div><p className="admin-eyebrow">KARIMOFF</p><h1>Обзор</h1><p>Продажи, себестоимость, склад и производство.</p></div></header>
    {overview.error || sales.error ? <p role="alert" className="admin-alert admin-alert-warning">Часть показателей недоступна. Обновите страницу.</p> : null}
    <section className="admin-overview-summary" aria-label="Сводка">
      <article className="is-revenue"><span>Выручка сегодня</span><strong>{sales.revenue === null ? "—" : `${number.format(sales.revenue)} ₽`}</strong><small>{sales.sales === null ? "данные недоступны" : `${sales.sales} продаж · МСК`}</small></article>
      <article className="is-orders"><span>Активных позиций</span><strong>{overview.error ? "—" : snapshot.activeProducts}</strong><small>{overview.error ? "данные недоступны" : `${snapshot.productsWithoutFoodCost} без полного food cost`}</small></article>
      <article className="is-kitchen"><span>Складских карточек</span><strong>{overview.error ? "—" : snapshot.inventoryCards}</strong><small>{overview.error ? "данные недоступны" : `${snapshot.lowStockItems} ниже минимума`}</small></article>
      <article className="is-ready"><span>Выпусков за 30 дней</span><strong>{overview.error ? "—" : snapshot.productionRuns30d}</strong><small>производство</small></article>
    </section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Разделы кабинета">{modules.map(([href,title,description])=><Link key={href} href={href} className="admin-card p-5"><h2 className="text-lg font-black">{title}</h2><p className="mt-2 text-sm text-karimoff-muted">{description}</p></Link>)}</section>
  </main>;
}
