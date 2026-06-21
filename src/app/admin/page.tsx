import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { logoutAction } from "./login/actions";

const cards = [
  { title: "Заказы", href: "/admin/orders", enabled: true },
  { title: "Заявки", href: "/admin/leads", enabled: true },
  { title: "Меню", href: "/admin/products", enabled: true },
  { title: "Ингредиенты", href: "/admin/ingredients", enabled: true },
  { title: "Пользователи", href: "/admin/customers", enabled: true },
  { title: "Юнит-экономика", href: "/admin/economics", enabled: true },
  { title: "Лояльность", href: "/admin/loyalty", enabled: true },
  { title: "Настройки", href: "/admin/settings", enabled: true },
  { title: "Франшиза", href: "#", enabled: false },
  { title: "Вакансии", href: "#", enabled: false }
];

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">KARIMOFF</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Админка KARIMOFF</h1>
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

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) =>
            card.enabled ? (
              <Link
                key={card.title}
                href={card.href}
                className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card transition hover:-translate-y-1 hover:border-karimoff-orange"
              >
                <h2 className="text-2xl font-black">{card.title}</h2>
                <p className="mt-3 text-sm leading-6 text-karimoff-muted">Открыть раздел</p>
              </Link>
            ) : (
              <div key={card.title} className="rounded-lg border border-karimoff-line bg-white/60 p-5 opacity-70">
                <h2 className="text-2xl font-black">{card.title}</h2>
                <p className="mt-3 text-sm leading-6 text-karimoff-muted">Скоро</p>
              </div>
            )
          )}
        </section>
      </div>
    </main>
  );
}
