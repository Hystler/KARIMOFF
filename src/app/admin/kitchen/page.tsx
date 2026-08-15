import { redirect } from "next/navigation";
import { KitchenWorkspace } from "@/components/operations/KitchenWorkspace";
import { OperationsUnavailable } from "@/components/operations/OperationsUnavailable";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { isOrderVisibleToKitchen } from "@/lib/order-flow/permissions";
import { getKitchenOperationsMetrics, getKitchenSla, getLatestOrderEventCursor, getOrderFlowQueue } from "@/lib/order-flow/queries";
import { saveKitchenSlaAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function KitchenPage({
  searchParams
}: {
  searchParams: Promise<{ location?: string; saved?: string; error?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  const params = await searchParams;
  let locations;
  try {
    locations = await getAccessibleOrderLocations(staff);
  } catch {
    return <OperationsUnavailable embedded title="Кухня временно недоступна" message="Проверьте связь и повторите." />;
  }
  const location = locations.find((item) => item.id === params.location || item.key === params.location)
    ?? locations.find((item) => item.isDefault)
    ?? locations[0];
  if (!location) return <OperationsUnavailable embedded title="Не настроена точка кухни" message="Добавьте активную точку в ERP." />;
  let orders;
  let sla;
  let initialCursor;
  let metrics;
  try {
    [orders, sla, initialCursor] = await Promise.all([
      getOrderFlowQueue({ locationId: location.id }),
      getKitchenSla(location.id),
      getLatestOrderEventCursor(location.id)
    ]);
    metrics = await getKitchenOperationsMetrics(location.id, sla);
  } catch {
    return <OperationsUnavailable embedded title="Очередь не загрузилась" message="Заказы не изменены. Повторите после проверки сети." />;
  }

  return (
    <main className="admin-content admin-content-wide">
      {params.saved ? <div className="admin-alert admin-alert-success">Настройки кухни сохранены.</div> : null}
      {params.error ? <div className="admin-alert admin-alert-error">{params.error}</div> : null}
      {staff.legacy || ["owner", "admin", "manager"].includes(staff.role) ? (
        <details className="admin-card mb-6 p-5 sm:p-6">
          <summary className="cursor-pointer list-none font-black">Настройки SLA и допуска заказов</summary>
          <form action={saveKitchenSlaAction} className="mt-5 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="location_id" value={location.id} />
            <label className="admin-field">Предупреждение, мин<input name="warning_minutes" type="number" min="1" max="120" defaultValue={Math.round(sla.warningSeconds / 60)} required /></label>
            <label className="admin-field">Критический SLA, мин<input name="critical_minutes" type="number" min="2" max="240" defaultValue={Math.round(sla.criticalSeconds / 60)} required /></label>
            <label className="admin-field">Заказ на табло, мин<input name="ready_display_minutes" type="number" min="1" max="1440" defaultValue={Math.round(sla.readyDisplaySeconds / 60)} required /></label>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-karimoff-line px-4 text-sm font-bold"><input name="online_requires_paid" type="checkbox" defaultChecked={sla.onlineRequiresPaid} className="h-5 w-5 accent-karimoff-orange" />Сайт: показывать после оплаты</label>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-karimoff-line px-4 text-sm font-bold"><input name="pos_requires_paid" type="checkbox" defaultChecked={sla.posRequiresPaid} className="h-5 w-5 accent-karimoff-orange" />POS: показывать после оплаты</label>
            <div className="rounded-lg bg-karimoff-cream px-4 py-3 text-sm leading-6 text-karimoff-muted">Склад списывается один раз при статусе «Готово». Это правило на этой итерации не меняется.</div>
            <button type="submit" className="admin-primary-button md:col-span-3">Сохранить настройки</button>
          </form>
        </details>
      ) : null}
      <KitchenWorkspace orders={orders.filter((order) => isOrderVisibleToKitchen(order, sla))} location={location} locations={locations} sla={sla} metrics={metrics} role={staff.role} staffName={staff.name} initialCursor={initialCursor} embedded />
    </main>
  );
}
