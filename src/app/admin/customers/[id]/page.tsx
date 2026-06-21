import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminCustomerById } from "@/lib/admin-customers";
import { logoutAction } from "../../login/actions";

type AdminCustomerDetailPageProps = {
  params: Promise<{ id: string }>;
};

const statusLabels = {
  new: "Новый",
  in_progress: "В работе",
  completed: "Выполнен",
  cancelled: "Отменён"
};

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

export default async function AdminCustomerDetailPage({ params }: AdminCustomerDetailPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const { id } = await params;
  const { customer, notConfigured, error } = await getAdminCustomerById(id);

  if (!notConfigured && !error && !customer) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin/customers" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Пользователи
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Карточка клиента</h1>
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
        ) : customer ? (
          <>
            <section className="mt-8 grid gap-5 lg:grid-cols-[1fr_0.85fr]">
              <article className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <AvatarPreview avatar={customer.avatar} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-karimoff-orange">Клиент</p>
                    <h2 className="mt-2 text-4xl font-black leading-none">{customer.name}</h2>
                    <p className="mt-4 text-sm font-semibold text-karimoff-muted">{customer.phone}</p>
                    <p className="mt-2 text-xs text-karimoff-muted">Регистрация: {formatDate(customer.created_at)}</p>
                    <p className="mt-1 text-xs text-karimoff-muted">Последний вход: {formatDate(customer.last_login_at)}</p>
                  </div>
                </div>
              </article>

              <article className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
                <p className="text-sm font-semibold text-karimoff-muted">Баланс баллов</p>
                <p className="mt-3 text-5xl font-black text-karimoff-orange">{formatNumber(customer.points_balance)}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-karimoff-soft p-4">
                    <p className="font-semibold text-karimoff-muted">Заказов</p>
                    <p className="mt-2 text-2xl font-black">{customer.order_count}</p>
                  </div>
                  <div className="rounded-xl bg-karimoff-soft p-4">
                    <p className="font-semibold text-karimoff-muted">Сумма</p>
                    <p className="mt-2 text-2xl font-black">{formatPrice(customer.order_total)} ₽</p>
                  </div>
                </div>
              </article>
            </section>

            <section className="mt-6 rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
              <h2 className="text-2xl font-black">Настройки аватара</h2>
              <div className="mt-4 grid gap-2 text-sm text-karimoff-muted sm:grid-cols-3">
                <p>Глаза: {customer.avatar_settings.eyes}</p>
                <p>Рот: {customer.avatar_settings.mouth}</p>
                <p>Аксессуар: {customer.avatar_settings.accessory}</p>
                <p>Одежда: {customer.avatar_settings.clothes}</p>
                <p>Фон: {customer.avatar_settings.background}</p>
              </div>
            </section>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
                <h2 className="text-2xl font-black">История заказов</h2>
                {customer.orders.length === 0 ? (
                  <p className="mt-5 text-sm text-karimoff-muted">Заказов пока нет.</p>
                ) : (
                  <div className="mt-5 grid gap-4">
                    {customer.orders.map((order) => (
                      <article key={order.id} className="rounded-xl border border-karimoff-line p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-black">{formatDate(order.created_at)}</p>
                            <p className="mt-1 text-xs font-semibold text-karimoff-orange">{statusLabels[order.status]}</p>
                          </div>
                          <p className="font-black text-karimoff-orange">{formatPrice(order.total)} ₽</p>
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

              <section className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
                <h2 className="text-2xl font-black">Лояльность</h2>
                {customer.transactions.length === 0 ? (
                  <p className="mt-5 text-sm text-karimoff-muted">Операций пока нет.</p>
                ) : (
                  <div className="mt-5 grid gap-3">
                    {customer.transactions.map((transaction) => (
                      <article key={transaction.id} className="rounded-xl border border-karimoff-line p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-black">{transaction.type}</p>
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
          </>
        ) : null}
      </div>
    </main>
  );
}
