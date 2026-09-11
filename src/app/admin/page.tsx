import {
  BarChart3,
  ArrowUpRight,
  ChartNoAxesCombined,
  Boxes,
  ChefHat,
  Factory,
  PackageOpen,
  Plug,
  Settings,
  ShoppingBag,
  SquareTerminal,
  Users,
  UtensilsCrossed
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAdminOrders } from "@/lib/orders";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { getMoscowDateKey, ORDER_TIME_ZONE } from "@/lib/order-time";
import { isStaleActiveOrder } from "@/lib/order-recency";

const cards = [
  { title: "Кухня", description: "Живая очередь и отметка готовности", href: "/admin/kitchen", icon: ChefHat },
  { title: "Заказы", description: "Статусы, время, состав и выдача", href: "/admin/orders", icon: ShoppingBag },
  { title: "Меню", description: "Товары, цены, добавки и состав", href: "/admin/products", icon: UtensilsCrossed },
  { title: "Ингредиенты", description: "Сырьё и себестоимость", href: "/admin/ingredients", icon: PackageOpen },
  { title: "Склад", description: "Остатки и движения", href: "/admin/inventory", icon: Boxes },
  { title: "Производство", description: "Выпуск, себестоимость и продажи франчайзи", href: "/admin/production", icon: Factory },
  { title: "Пользователи", description: "Клиенты, профили и история", href: "/admin/customers", icon: Users },
  { title: "Экономика", description: "Маржинальность и расходы", href: "/admin/economics", icon: BarChart3 },
  { title: "Аналитика", description: "Каналы, выручка, чеки и спрос", href: "/admin/analytics", icon: ChartNoAxesCombined },
  { title: "Эвотор", description: "Подключение, кассы и синхронизация", href: "/admin/integrations/evotor", icon: Plug },
  { title: "Настройки", description: "Контакты, фоны и режимы", href: "/admin/settings", icon: Settings }
];

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/kitchen");
  if (staff.role === "cashier") redirect("/pos");

  const locations = await getAccessibleOrderLocations(staff);
  const locationIds = staff.legacy || ["owner", "admin"].includes(staff.role)
    ? null
    : locations.map((location) => location.id);
  const { orders, error, notConfigured } = await getAdminOrders(locationIds);
  const activeOrders = orders.filter((order) => order.is_operational && !isStaleActiveOrder(order) && !["handed_out", "cancelled"].includes(order.kitchen_status))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const newCount = activeOrders.filter((order) => ["new", "accepted"].includes(order.kitchen_status)).length;
  const inProgressCount = activeOrders.filter((order) => order.kitchen_status === "cooking").length;
  const readyCount = activeOrders.filter((order) => order.kitchen_status === "ready").length;
  const todayKey = getMoscowDateKey();
  const todayOrders = orders.filter((order) => getMoscowDateKey(new Date(order.created_at)) === todayKey && order.status !== "cancelled");
  const todayTotal = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: ORDER_TIME_ZONE }).format(new Date());
  const statusLabels = { new: "Новый", accepted: "Принят", cooking: "Готовится", ready: "Готов", handed_out: "Выдан", cancelled: "Отменён" };

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">{dateLabel}</p>
          <h1>Обзор</h1>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/pos" className="admin-secondary-button"><SquareTerminal size={17} />Касса</Link><Link href="/kitchen" className="admin-primary-button">
          <ChefHat size={19} />
          Открыть кухню
        </Link></div>
      </header>

      {error || notConfigured ? <p role="alert" className="admin-alert admin-alert-error">Не удалось загрузить заказы. Попробуйте обновить страницу.</p> : null}
      <section className="admin-metrics admin-overview-metrics" aria-label="Заказы">
        <article><span>Новые заказы</span><strong>{newCount}</strong></article>
        <article><span>Готовятся</span><strong>{inProgressCount}</strong></article>
        <article><span>Ожидают выдачи</span><strong className="text-emerald-700">{readyCount}</strong></article>
        <article><span>Заказов сегодня</span><strong>{todayOrders.length}</strong></article>
        <article><span>{process.env.TEST_ORDER_MODE === "true" ? "Тестовая сумма сегодня" : "Сумма заказов сегодня"}</span><strong>{new Intl.NumberFormat("ru-RU").format(todayTotal)} ₽</strong></article>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">В работе · {activeOrders.length}</h2><Link href="/admin/orders" className="text-sm font-semibold text-karimoff-orange">Все заказы</Link></div>
        <div className="max-w-full overflow-x-auto border-y border-karimoff-line bg-white">
          <table className="admin-table min-w-[620px]">
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
      <section className="mt-6">
        <h2 className="mb-3 text-base font-bold">Разделы</h2>
        <div className="admin-overview-links">{cards.map(({ title, href, icon: Icon }) => (
          <Link key={href} href={href} className="admin-overview-link"><Icon size={19} /><span>{title}</span><ArrowUpRight size={16} /></Link>
        ))}</div>
      </section>
    </main>
  );
}
