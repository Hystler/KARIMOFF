import { PickupDisplay } from "@/components/operations/PickupDisplay";
import { OperationsUnavailable } from "@/components/operations/OperationsUnavailable";
import { isOrderVisibleToKitchen } from "@/lib/order-flow/permissions";
import { getKitchenSla, getLatestOrderEventCursor, getOrderFlowQueue, getOrderLocations } from "@/lib/order-flow/queries";
import type { PublicDisplayOrder } from "@/lib/order-flow/types";

export const dynamic = "force-dynamic";

export default async function DisplayPage({
  searchParams
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const params = await searchParams;
  let locations;
  try {
    locations = await getOrderLocations();
  } catch {
    return <OperationsUnavailable title="Табло временно недоступно" message="Мы переподключаемся. Повторите через несколько секунд." />;
  }
  const location = locations.find((item) => item.id === params.location || item.key === params.location)
    ?? locations.find((item) => item.isDefault)
    ?? locations[0];
  if (!location) return <OperationsUnavailable title="Не настроена точка выдачи" message="Табло появится после настройки точки." />;
  let orders;
  let initialCursor;
  let sla;
  try {
    [orders, initialCursor, sla] = await Promise.all([
      getOrderFlowQueue({ locationId: location.id, statuses: ["new", "accepted", "cooking", "ready"], limit: 100 }),
      getLatestOrderEventCursor(location.id),
      getKitchenSla(location.id)
    ]);
  } catch {
    return <OperationsUnavailable title="Табло временно недоступно" message="Заказы не изменены. Проверьте связь и повторите." />;
  }
  const publicOrders: PublicDisplayOrder[] = orders
    .filter((order) => isOrderVisibleToKitchen(order, sla))
    .map((order) => ({
      id: order.id,
      displayNumber: order.displayNumber,
      kitchenStatus: order.kitchenStatus,
      publicDisplayName: order.publicDisplayName,
      publicAvatarSeed: order.publicAvatarSeed,
      publicAvatar: order.publicAvatar,
      isTest: order.isTest
    }));
  return <PickupDisplay orders={publicOrders} location={location} initialCursor={initialCursor} />;
}
