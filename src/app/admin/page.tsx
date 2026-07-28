import {
  BarChart3,
  Boxes,
  ChefHat,
  PackageOpen,
  Settings,
  ShoppingBag,
  Users,
  UtensilsCrossed
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAdminOrders } from "@/lib/orders";

const cards = [
  { title: "Кухня", description: "Живая очередь и отметка готовности", href: "/admin/kitchen", icon: ChefHat },
  { title: "Заказы", description: "Статусы, время, состав и выдача", href: "/admin/orders", icon: ShoppingBag },
  { title: "Меню", description: "Товары, цены, добавки и состав", href: "/admin/products", icon: UtensilsCrossed },
  { title: "Ингредиенты", description: "Сырьё и себестоимость", href: "/admin/ingredients", icon: PackageOpen },
  { title: "Склад", description: "Остатки и движения", href: "/admin/inventory", icon: Boxes },
  { title: "Пользователи", description: "Клиенты, профили и история", href: "/admin/customers", icon: Users },
  { title: "Экономика", description: "Маржинальность и расходы", href: "/admin/economics", icon: BarChart3 },
  { title: "Настройки", description: "Контакты, фоны и режимы", href: "/admin/settings", icon: Settings }
];

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/admin/kitchen");

  const { orders } = await getAdminOrders();
  const newCount = orders.filter((order) => order.status === "new").length;
  const inProgressCount = orders.filter((order) => order.status === "in_progress").length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((order) => order.created_at.slice(0, 10) === todayKey);
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Рабочий день</p>
          <h1>Добро пожаловать, {staff.name}</h1>
          <p>Главное по заказам и быстрый доступ к операционным разделам.</p>
        </div>
        <Link href="/admin/kitchen" className="admin-primary-button">
          <ChefHat size={19} />
          Открыть кухню
        </Link>
      </header>

      <section className="admin-metrics">
        <article><span>Новые заказы</span><strong>{newCount}</strong></article>
        <article><span>Готовятся</span><strong>{inProgressCount}</strong></article>
        <article><span>Заказов сегодня</span><strong>{todayOrders.length}</strong></article>
        <article><span>Сумма сегодня</span><strong>{new Intl.NumberFormat("ru-RU").format(todayRevenue)} ₽</strong></article>
      </section>

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, description, href, icon: Icon }) => (
          <Link key={href} href={href} className="admin-dashboard-card">
            <span className="admin-dashboard-icon"><Icon size={22} /></span>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="mt-auto pt-5 text-sm font-black text-karimoff-orange">Открыть</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
