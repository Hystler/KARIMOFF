import Link from "next/link";
import { redirect } from "next/navigation";
import { RepeatOrderButton } from "@/components/profile/RepeatOrderButton";
import { getCustomerProfileData } from "@/lib/customer-data";
import { logoutCustomerAction } from "./actions";

export const dynamic = "force-dynamic";

const statusLabels = {
  new: "Новый",
  in_progress: "В работе",
  completed: "Выполнен",
  cancelled: "Отменён"
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export default async function ProfilePage() {
  const { customer, account, orders, transactions, error } = await getCustomerProfileData();

  if (!customer) {
    redirect("/login");
  }

  return (
    <main className="bg-karimoff-cream pt-28 text-karimoff-black">
      <section className="container-page pb-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Профиль</p>
            <h1 className="mt-3 text-4xl font-black leading-none sm:text-6xl">{customer.name}</h1>
            <p className="mt-4 text-base font-semibold text-karimoff-muted">{customer.phone}</p>
          </div>
          <form action={logoutCustomerAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
        </div>

        {error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Баланс баллов</p>
            <p className="mt-3 text-5xl font-black text-karimoff-orange">{formatNumber(account?.points_balance ?? 0)}</p>
            <p className="mt-3 text-sm leading-6 text-karimoff-muted">
              Баллы пока можно копить. Списание добавим отдельной итерацией.
            </p>
          </article>
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Всего начислено</p>
            <p className="mt-3 text-4xl font-black text-karimoff-black">{formatNumber(account?.total_earned ?? 0)}</p>
          </article>
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Заказов</p>
            <p className="mt-3 text-4xl font-black text-karimoff-black">{orders.length}</p>
          </article>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black">История заказов</h2>
              <Link href="/menu" className="text-sm font-bold text-karimoff-orange">
                В меню
              </Link>
            </div>
            {orders.length === 0 ? (
              <p className="mt-5 text-sm text-karimoff-muted">Заказов пока нет.</p>
            ) : (
              <div className="mt-5 grid gap-4">
                {orders.map((order) => (
                  <article key={order.id} className="rounded-lg border border-karimoff-line p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-black text-karimoff-black">{formatDate(order.created_at)}</p>
                        <p className="mt-1 text-xs font-semibold text-karimoff-orange">{statusLabels[order.status]}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-black text-karimoff-orange">{formatPrice(order.total)} ₽</p>
                        {order.items.length ? <RepeatOrderButton items={order.items} orderId={order.id} /> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      {order.items.map((item) => (
                        <p key={item.id} className="text-sm leading-6 text-karimoff-muted">
                          {item.product_name} × {item.quantity} — {formatPrice(item.line_total)} ₽
                        </p>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <h2 className="text-2xl font-black">Начисления</h2>
            {transactions.length === 0 ? (
              <p className="mt-5 text-sm text-karimoff-muted">Начислений пока нет.</p>
            ) : (
              <div className="mt-5 grid gap-3">
                {transactions.map((transaction) => (
                  <article key={transaction.id} className="rounded-lg border border-karimoff-line p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-black text-karimoff-black">{transaction.type}</p>
                        <p className="mt-1 text-xs text-karimoff-muted">{formatDate(transaction.created_at)}</p>
                      </div>
                      <p className="font-black text-karimoff-orange">{formatNumber(transaction.points)}</p>
                    </div>
                    {transaction.description ? (
                      <p className="mt-3 text-xs leading-5 text-karimoff-muted">{transaction.description}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
