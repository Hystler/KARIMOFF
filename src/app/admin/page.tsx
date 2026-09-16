import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  ChefHat,
  Factory,
  Monitor,
  PackageOpen,
  ShoppingBag,
  UtensilsCrossed
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminOverviewSnapshot } from "@/lib/admin-overview";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAdminOrders } from "@/lib/orders";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { getMoscowDateKey, ORDER_TIME_ZONE } from "@/lib/order-time";
import { isStaleActiveOrder } from "@/lib/order-recency";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("ru-RU");

function DashboardLink({
  href,
  title,
  description,
  value,
  meta,
  tone,
  icon: Icon
}: {
  href: string;
  title: string;
  description: string;
  value: string | number;
  meta: string;
  tone: "orange" | "blue" | "green" | "gold" | "violet" | "red";
  icon: typeof ChefHat;
}) {
  return (
    <Link href={href} className={`admin-overview-module is-${tone}`}>
      <span className="admin-overview-module-icon"><Icon size={19} /></span>
      <span className="admin-overview-module-copy"><strong>{title}</strong><small>{description}</small></span>
      <span className="admin-overview-module-metric"><strong>{value}</strong><small>{meta}</small></span>
      <ArrowUpRight size={17} className="admin-overview-module-arrow" />
    </Link>
  );
}

export default async function AdminPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/kitchen");
  if (staff.role === "cashier") redirect("/pos");

  const locations = await getAccessibleOrderLocations(staff);
  const locationIds = staff.legacy || ["owner", "admin"].includes(staff.role)
    ? null
    : locations.map((location) => location.id);
  const [{ orders, error, notConfigured }, overview] = await Promise.all([
    getAdminOrders(locationIds),
    getAdminOverviewSnapshot()
  ]);
  const activeOrders = orders
    .filter((order) => order.is_operational && !isStaleActiveOrder(order) && !["handed_out", "cancelled"].includes(order.kitchen_status))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const newCount = activeOrders.filter((order) => ["new", "accepted"].includes(order.kitchen_status)).length;
  const inProgressCount = activeOrders.filter((order) => order.kitchen_status === "cooking").length;
  const readyCount = activeOrders.filter((order) => order.kitchen_status === "ready").length;
  const todayKey = getMoscowDateKey();
  const todayOrders = orders.filter((order) => getMoscowDateKey(new Date(order.created_at)) === todayKey && order.status !== "cancelled");
  const todayTotal = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: ORDER_TIME_ZONE }).format(new Date());
  const statusLabels = { new: "Новый", accepted: "Принят", cooking: "Готовится", ready: "Готов", handed_out: "Выдан", cancelled: "Отменён" };
  const snapshot = overview.snapshot;

  return (
    <main className="admin-content admin-overview-dashboard">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Операционный центр · {dateLabel}</p>
          <h1>Обзор</h1>
          <p>Заказы, кухня, меню и производство в одном рабочем экране.</p>
        </div>
      </header>

      {error || notConfigured ? <p role="alert" className="admin-alert admin-alert-error">Не удалось загрузить заказы. Попробуйте обновить страницу.</p> : null}
      {overview.error ? <p role="alert" className="admin-alert admin-alert-warning">Часть сводных показателей временно недоступна.</p> : null}

      <section className="admin-overview-summary" aria-label="Итоги дня">
        <article className="is-revenue"><span>Выручка сегодня</span><strong>{number.format(todayTotal)} ₽</strong><small>{todayOrders.length} заказов</small></article>
        <article className="is-orders"><span>В работе</span><strong>{activeOrders.length}</strong><small>{newCount} новых</small></article>
        <article className="is-kitchen"><span>На кухне</span><strong>{inProgressCount}</strong><small>готовятся сейчас</small></article>
        <article className="is-ready"><span>К выдаче</span><strong>{readyCount}</strong><small>видны на табло</small></article>
      </section>

      <section className="admin-overview-workflow" aria-labelledby="overview-workflow-title">
        <header><div><p className="admin-eyebrow">Живая смена</p><h2 id="overview-workflow-title">Поток заказов</h2></div><Link href="/admin/orders">Все заказы <ArrowUpRight size={15} /></Link></header>
        <div className="admin-overview-lanes">
          <Link href="/admin/orders" className="is-new"><span>Новые</span><strong>{newCount}</strong><small>нужно принять</small></Link>
          <Link href="/admin/kitchen" className="is-cooking"><span>Готовятся</span><strong>{inProgressCount}</strong><small>очередь кухни</small></Link>
          <Link href="/display" className="is-ready"><span>Готовы</span><strong>{readyCount}</strong><small>ожидают выдачи</small></Link>
        </div>
      </section>

      <section className="admin-overview-modules" aria-label="Состояние системы">
        <DashboardLink href="/admin/kitchen" title="Кухня" description="Очередь и станции" value={inProgressCount} meta="заказов готовится" tone="orange" icon={ChefHat} />
        <DashboardLink href="/admin/orders" title="Заказы" description="Статусы и выдача" value={todayOrders.length} meta="за сегодня" tone="blue" icon={ShoppingBag} />
        <DashboardLink href="/admin/products" title="Меню" description="Цены и техкарты" value={snapshot.activeProducts} meta={snapshot.productsWithoutFoodCost ? `${snapshot.productsWithoutFoodCost} без полного food cost` : "food cost заполнен"} tone={snapshot.productsWithoutFoodCost ? "red" : "green"} icon={UtensilsCrossed} />
        <DashboardLink href="/admin/ingredients" title="Ингредиенты" description="Цена и КБЖУ" value={snapshot.activeIngredients} meta={snapshot.ingredientsWithoutNutrition ? `${snapshot.ingredientsWithoutNutrition} требуют КБЖУ` : "КБЖУ заполнены"} tone={snapshot.ingredientsWithoutNutrition ? "gold" : "green"} icon={PackageOpen} />
        <DashboardLink href="/admin/inventory" title="Склад" description="Остатки и движения" value={snapshot.inventoryCards} meta={snapshot.lowStockItems ? `${snapshot.lowStockItems} ниже минимума` : "остатки в норме"} tone={snapshot.lowStockItems ? "red" : "green"} icon={Boxes} />
        <DashboardLink href="/display" title="Экран выдачи" description="Готовые заказы" value={readyCount} meta={`${snapshot.activeLocations} активных точек`} tone="violet" icon={Monitor} />
        <DashboardLink href="/admin/production" title="Производство" description="Карты и выпуски" value={snapshot.productionRecipes} meta={`${snapshot.productionRuns30d} выпусков за 30 дней`} tone="gold" icon={Factory} />
        <DashboardLink href="/admin/analytics" title="Аналитика" description="Выручка и food cost" value={snapshot.productsWithoutNutrition} meta="товаров требуют проверки КБЖУ" tone="blue" icon={BarChart3} />
      </section>

      {(snapshot.hiddenProducts > 0 || snapshot.ingredientsWithoutPrice > 0) ? (
        <section className="admin-overview-attention" aria-label="Требует внимания">
          <AlertTriangle size={18} />
          <div><strong>Требует внимания</strong><span>{snapshot.hiddenProducts} товаров в архиве · {snapshot.ingredientsWithoutPrice} ингредиентов без закупочной цены</span></div>
          <Link href="/admin/products">Проверить меню</Link>
        </section>
      ) : null}

      <section className="admin-overview-orders">
        <header><div><p className="admin-eyebrow">Последние</p><h2>Заказы в работе</h2></div><span>{activeOrders.length}</span></header>
        <div className="max-w-full overflow-x-auto">
          <table className="admin-table min-w-[680px]">
            <thead><tr><th>Заказ</th><th>Время</th><th>Гость</th><th>Состав</th><th>Статус</th></tr></thead>
            <tbody>{activeOrders.slice(0, 8).map((order) => <tr key={order.id}>
              <td className="font-bold">{order.display_number}{order.is_test ? <span className="ml-2 text-xs text-sky-700">Тест</span> : null}</td>
              <td className="tabular-nums">{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: ORDER_TIME_ZONE }).format(new Date(order.created_at))}</td>
              <td>{order.customer_name || "Гость"}</td>
              <td className="max-w-sm">{order.items.map((item) => `${item.product_name} × ${item.quantity}`).join(", ")}</td>
              <td><span className={`admin-order-status admin-order-status-${order.kitchen_status}`}>{statusLabels[order.kitchen_status]}</span></td>
            </tr>)}{!activeOrders.length ? <tr><td colSpan={5} className="text-karimoff-muted">Нет заказов в работе</td></tr> : null}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
