import { redirect } from "next/navigation";
import { KitchenWorkspace } from "@/components/operations/KitchenWorkspace";
import { OperationsUnavailable } from "@/components/operations/OperationsUnavailable";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { canAccessKitchen, isOrderVisibleToKitchen } from "@/lib/order-flow/permissions";
import { getKitchenOperationsMetrics, getKitchenSla, getLatestOrderEventCursor, getOrderFlowQueue } from "@/lib/order-flow/queries";

export const dynamic = "force-dynamic";

export default async function KitchenPage({
  searchParams
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login?redirectTo=/kitchen");
  if (!canAccessKitchen(staff.role)) redirect("/admin");
  const params = await searchParams;
  let locations;
  try {
    locations = await getAccessibleOrderLocations(staff);
  } catch {
    return <OperationsUnavailable title="Кухня временно недоступна" message="Не удалось получить точки. Проверьте связь и повторите." />;
  }
  const location = locations.find((item) => item.id === params.location || item.key === params.location)
    ?? locations.find((item) => item.isDefault)
    ?? locations[0];
  if (!location) return <OperationsUnavailable title="Не настроена точка кухни" message="Добавьте активную точку в ERP." />;
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
    return <OperationsUnavailable title="Очередь не загрузилась" message="Заказы не изменены. Проверьте сеть и повторите." />;
  }
  return <KitchenWorkspace orders={orders.filter((order) => isOrderVisibleToKitchen(order, sla))} location={location} locations={locations} sla={sla} metrics={metrics} role={staff.role} staffName={staff.name} initialCursor={initialCursor} />;
}
