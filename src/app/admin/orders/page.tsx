import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminOrders, type AdminOrder } from "@/lib/orders";
import { logoutAction } from "../login/actions";
import { deleteOrderAction, updateOrderStatusAction } from "./actions";

type AdminOrdersPageProps = {
  searchParams?: Promise<{
    deleted?: string;
    error?: string;
    saved?: string;
  }>;
};

const statusLabels: Record<AdminOrder["status"], string> = {
  new: "Новый",
  in_progress: "В работе",
  completed: "Выполнен",
  cancelled: "Отменён"
};

const deliveryLabels: Record<AdminOrder["delivery_type"], string> = {
  pickup: "Самовывоз",
  delivery: "Доставка"
};

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

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function getMessage(params: Awaited<NonNullable<AdminOrdersPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Статус заказа обновлён." };
  }

  if (params.deleted) {
    return { tone: "success", text: "Заказ удалён." };
  }

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
  }

  return null;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { orders, notConfigured, error } = await getAdminOrders();

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Заказы</h1>
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

        {message ? (
          <div
            className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${
              message.tone === "success"
                ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить заказы: {error}</div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Заказов пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Дата</th>
                    <th className="px-4 py-4 font-bold">Клиент</th>
                    <th className="px-4 py-4 font-bold">Получение</th>
                    <th className="px-4 py-4 font-bold">Состав</th>
                    <th className="px-4 py-4 font-bold">Сумма</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-karimoff-line align-top last:border-b-0">
                      <td className="px-4 py-4 text-karimoff-muted">{formatDate(order.created_at)}</td>
                      <td className="px-4 py-4">
                        <p className="font-semibold">{order.customer_name}</p>
                        <p className="mt-1 text-xs text-karimoff-muted">{order.customer_phone}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold">{deliveryLabels[order.delivery_type]}</p>
                        {order.address ? <p className="mt-1 max-w-48 text-xs text-karimoff-muted">{order.address}</p> : null}
                        {order.comment ? <p className="mt-2 max-w-48 text-xs text-karimoff-muted">Комментарий: {order.comment}</p> : null}
                      </td>
                      <td className="px-4 py-4">
                        <div className="grid gap-2">
                          {order.items.map((item) => (
                            <p key={item.id} className="text-xs leading-5 text-karimoff-muted">
                              {item.product_name} × {item.quantity} — {formatPrice(item.line_total)} ₽
                            </p>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 font-black text-karimoff-orange">{formatPrice(order.total)} ₽</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-karimoff-orange/10 px-3 py-1 text-xs font-bold text-karimoff-orange">
                          {statusLabels[order.status]}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <form action={updateOrderStatusAction} className="flex gap-2">
                            <input type="hidden" name="id" value={order.id} />
                            <select
                              name="status"
                              defaultValue={order.status}
                              className="rounded-full border border-karimoff-line bg-white px-3 py-2 text-xs font-bold outline-none focus:border-karimoff-orange"
                            >
                              {Object.entries(statusLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-[#D95405]"
                            >
                              Сохранить
                            </button>
                          </form>
                          <form action={deleteOrderAction}>
                            <input type="hidden" name="id" value={order.id} />
                            <ConfirmSubmitButton
                              message={`Удалить заказ ${order.id}?`}
                              className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                            >
                              Удалить
                            </ConfirmSubmitButton>
                          </form>
                        </div>
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
