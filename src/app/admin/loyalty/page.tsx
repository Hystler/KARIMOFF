import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminLoyalty } from "@/lib/loyalty";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

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

export default async function AdminLoyaltyPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const { customers, transactions, notConfigured, error } = await getAdminLoyalty();

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Лояльность</h1>
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

        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">
            Supabase не подключён. Заполните переменные окружения.
          </div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">{error}</div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="rounded-lg border border-karimoff-line bg-white shadow-card">
              <div className="border-b border-karimoff-line p-5">
                <h2 className="text-2xl font-black">Клиенты</h2>
              </div>
              {customers.length === 0 ? (
                <div className="p-6 text-karimoff-muted">Клиентов пока нет.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                      <tr>
                        <th className="px-4 py-4 font-bold">Клиент</th>
                        <th className="px-4 py-4 font-bold">Баланс</th>
                        <th className="px-4 py-4 font-bold">Всего начислено</th>
                        <th className="px-4 py-4 font-bold">Создан</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr key={customer.id} className="border-b border-karimoff-line last:border-b-0">
                          <td className="px-4 py-4">
                            <p className="font-bold">{customer.name}</p>
                            <p className="mt-1 text-xs text-karimoff-muted">{customer.phone}</p>
                          </td>
                          <td className="px-4 py-4 font-black text-karimoff-orange">{formatNumber(customer.points_balance)}</td>
                          <td className="px-4 py-4">{formatNumber(customer.total_earned)}</td>
                          <td className="px-4 py-4 text-karimoff-muted">{formatDate(customer.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
              <h2 className="text-2xl font-black">Последние операции</h2>
              {transactions.length === 0 ? (
                <p className="mt-5 text-sm text-karimoff-muted">Операций пока нет.</p>
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
        )}
      </div>
    </main>
  );
}
