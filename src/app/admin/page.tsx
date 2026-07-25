import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { logoutAction } from "./login/actions";

const cards = [
  { title: "Заказы", description: "Статусы, состав и выдача", href: "/admin/orders", enabled: true },
  { title: "Заявки", description: "B2B, работа и франшиза", href: "/admin/leads", enabled: true },
  { title: "Меню", description: "Товары, цены и состав", href: "/admin/products", enabled: true },
  { title: "Ингредиенты", description: "Сырьё и себестоимость", href: "/admin/ingredients", enabled: true },
  { title: "Склад", description: "Остатки и движения", href: "/admin/inventory", enabled: true },
  { title: "Пользователи", description: "Профили и история заказов", href: "/admin/customers", enabled: true },
  { title: "Юнит-экономика", description: "Маржинальность и расходы", href: "/admin/economics", enabled: true },
  { title: "Лояльность", description: "Баллы и начисления", href: "/admin/loyalty", enabled: true },
  { title: "Настройки", description: "Контакты, фоны и режимы", href: "/admin/settings", enabled: true },
  { title: "Cookie-согласия", description: "Выбор посетителей сайта", href: "/admin/cookies", enabled: true },
  { title: "Вакансии", description: "Публикации и отклики", href: "/admin/vacancies", enabled: true },
  { title: "Франшиза", description: "Раздел в подготовке", href: "#", enabled: false }
];

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  return (
    <main className="admin-page">
      <div className="admin-shell max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">KARIMOFF</p>
            <h1 className="admin-page-title">Панель управления</h1>
            <p className="mt-2 text-sm leading-6 text-karimoff-muted">Операционная работа с сайтом и заказами.</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) =>
            card.enabled ? (
              <Link
                key={card.title}
                href={card.href}
                className="group flex min-h-[150px] flex-col rounded-lg border border-karimoff-line bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-karimoff-orange"
              >
                <h2 className="text-xl font-black">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">{card.description}</p>
                <span className="mt-auto pt-4 text-sm font-bold text-karimoff-orange transition group-hover:translate-x-0.5">
                  Открыть
                </span>
              </Link>
            ) : (
              <div key={card.title} className="flex min-h-[150px] flex-col rounded-lg border border-karimoff-line bg-white/60 p-5 opacity-70">
                <h2 className="text-xl font-black">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">{card.description}</p>
                <p className="mt-auto pt-4 text-sm font-bold text-karimoff-muted">Скоро</p>
              </div>
            )
          )}
        </section>
      </div>
    </main>
  );
}
