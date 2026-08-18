import Link from "next/link";
import { redirect } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { IdentityAvatar } from "@/components/auth/IdentityAvatar";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminCustomers } from "@/lib/admin-customers";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

function formatDate(date: string | null) {
  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export default async function AdminCustomersPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const { customers, notConfigured, error } = await getAdminCustomers();

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Пользователи</h1>
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

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">База данных не подключена. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить пользователей: {error}</div>
          ) : customers.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Пользователей пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table min-w-[1120px]">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Пользователь</th>
                    <th className="px-4 py-4 font-bold">Регистрация</th>
                    <th className="px-4 py-4 font-bold">Последний вход</th>
                    <th className="px-4 py-4 font-bold">Способы входа</th>
                    <th className="px-4 py-4 font-bold">Баллы</th>
                    <th className="px-4 py-4 font-bold">Заказы</th>
                    <th className="px-4 py-4 font-bold">Сумма заказов</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} className="border-b border-karimoff-line align-middle last:border-b-0">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <AvatarPreview avatar={customer.avatar} size="sm" />
                          <div>
                            <p className="font-black text-karimoff-black">{customer.name}</p>
                            <p className="mt-1 text-xs font-semibold text-karimoff-muted">{customer.phone}</p>
                            <p className="mt-1 font-mono text-[10px] text-karimoff-muted">{customer.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-karimoff-muted">{formatDate(customer.created_at)}</td>
                      <td className="px-4 py-4 text-karimoff-muted">{formatDate(customer.last_login_at)}</td>
                      <td className="px-4 py-4">
                        <div className="flex -space-x-1">
                          {customer.identities.map((identity) => (
                            <IdentityAvatar
                              key={identity.id}
                              identityId={identity.id}
                              label={identity.provider === "phone" ? "+7" : identity.provider === "telegram" ? "T" : "VK"}
                              hasImage={Boolean(identity.avatarUrl)}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 font-black text-karimoff-orange">{formatNumber(customer.points_balance)}</td>
                      <td className="px-4 py-4 font-semibold">{customer.order_count}</td>
                      <td className="px-4 py-4 font-black">{formatPrice(customer.order_total)} ₽</td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="rounded-full border border-karimoff-orange bg-karimoff-orange px-4 py-2 text-xs font-bold text-white shadow-[0_10px_24px_rgba(251,103,10,0.16)] transition hover:bg-[#D95405]"
                        >
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
