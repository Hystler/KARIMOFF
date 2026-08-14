import { ArrowLeft, Link2, ShieldCheck, Unlink2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { getOrderReconciliationWorkspace } from "@/lib/order-flow/reconciliation";
import {
  confirmSaleReconciliationAction,
  removeSaleReconciliationAction
} from "./actions";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Moscow"
});
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function orderSourceLabel(source: string) {
  if (source === "pos" || source === "kiosk") return "Касса";
  if (source === "mobile") return "Приложение";
  return "Сайт";
}

export default async function EvotorReconciliationPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; saved?: string; removed?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  const params = await searchParams;
  const locations = await getAccessibleOrderLocations(staff);
  const locationIds = staff.legacy || ["owner", "admin"].includes(staff.role)
    ? null
    : locations.map((location) => location.id);
  const workspace = await getOrderReconciliationWorkspace(locationIds);

  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div className="max-w-3xl">
          <Link href="/admin/integrations/evotor" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-karimoff-muted hover:text-karimoff-orange">
            <ArrowLeft size={16} /> Эвотор
          </Link>
          <p className="admin-eyebrow">Защита от дублей</p>
          <h1>Сопоставление продаж</h1>
          <p>Свяжите внутренний заказ с фискальным чеком только при уверенном ручном подтверждении.</p>
        </div>
      </header>

      {params.saved ? <div className="admin-alert admin-alert-success">Связь подтверждена. В аналитике продажа считается один раз.</div> : null}
      {params.removed ? <div className="admin-alert admin-alert-success">Связь удалена. Исходные заказ и чек не изменены.</div> : null}
      {params.error ? <div className="admin-alert admin-alert-error">{params.error}</div> : null}

      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form action={confirmSaleReconciliationAction} className="admin-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-karimoff-orange text-white"><Link2 size={21} /></span>
            <div>
              <h2 className="text-xl font-black">Подтвердить связь</h2>
              <p className="mt-1 text-sm leading-6 text-karimoff-muted">Сумма и время показаны для проверки, но система не использует их для автоматического объединения.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4">
            <label className="admin-field">
              Заказ KARIMOFF
              <select name="order_id" required defaultValue="">
                <option value="" disabled>Выберите заказ</option>
                {workspace.orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.displayNumber} · {orderSourceLabel(order.source)} · {dateTime.format(new Date(order.createdAt))} · {money.format(order.total)} ₽ · {order.locationName}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              Чек Эвотор
              <select name="receipt_id" required defaultValue="">
                <option value="" disabled>Выберите чек</option>
                {workspace.receipts.map((receipt) => (
                  <option key={receipt.id} value={receipt.id}>
                    № {receipt.number} · {dateTime.format(new Date(receipt.closedAt))} · {money.format(receipt.total)} ₽ · {receipt.locationName}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="admin-primary-button min-h-12" disabled={!workspace.orders.length || !workspace.receipts.length}>
              <Link2 size={18} /> Подтвердить сопоставление
            </button>
          </div>
        </form>

        <aside className="admin-card p-5 sm:p-6">
          <ShieldCheck className="text-karimoff-orange" size={26} />
          <h2 className="mt-4 text-lg font-black">Что изменится</h2>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-karimoff-muted">
            <li>Продажа будет учитываться в аналитике один раз.</li>
            <li>Чек Эвотор и заказ останутся без изменений.</li>
            <li>Склад повторно списан не будет.</li>
          </ul>
        </aside>
      </section>

      <section className="admin-card mt-7 overflow-hidden">
        <div className="border-b border-karimoff-line px-5 py-5 sm:px-6">
          <p className="admin-eyebrow">Подтверждено</p>
          <h2 className="mt-2 text-xl font-black">Связанные продажи</h2>
        </div>
        {workspace.confirmed.length ? (
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[920px]">
              <thead><tr><th>Заказ</th><th>Чек</th><th>Точка</th><th>Суммы</th><th>Подтверждено</th><th>Действие</th></tr></thead>
              <tbody>
                {workspace.confirmed.map((link) => (
                  <tr key={link.id}>
                    <td><strong>{link.orderNumber}</strong><p className="mt-1 text-xs text-karimoff-muted">{orderSourceLabel(link.orderSource)}</p></td>
                    <td><strong>№ {link.receiptNumber}</strong></td>
                    <td>{link.locationName}</td>
                    <td>{money.format(link.orderTotal)} ₽ / {money.format(link.receiptTotal)} ₽</td>
                    <td>{link.confirmedAt ? dateTime.format(new Date(link.confirmedAt)) : "—"}</td>
                    <td>
                      <form action={removeSaleReconciliationAction}>
                        <input type="hidden" name="link_id" value={link.id} />
                        <button type="submit" className="admin-secondary-button text-red-700"><Unlink2 size={16} /> Удалить связь</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="admin-empty">Подтверждённых связей пока нет.</div>}
      </section>
    </main>
  );
}
