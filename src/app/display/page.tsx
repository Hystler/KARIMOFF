import { PickupDisplay } from "@/components/operations/PickupDisplay";
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
  const locations = await getOrderLocations();
  const location = locations.find((item) => item.id === params.location || item.key === params.location)
    ?? locations.find((item) => item.isDefault)
    ?? locations[0];
  if (!location) throw new Error("Не настроена точка выдачи.");
  const [orders, initialCursor, sla] = await Promise.all([
    getOrderFlowQueue({
      locationId: location.id,
      statuses: ["new", "accepted", "cooking", "ready"],
      limit: 100
    }),
    getLatestOrderEventCursor(location.id),
    getKitchenSla(location.id)
  ]);
  const publicOrders: PublicDisplayOrder[] = orders
    .filter((order) => isOrderVisibleToKitchen(order, sla))
    .map((order) => ({
      id: order.id,
      displayNumber: order.displayNumber,
      kitchenStatus: order.kitchenStatus,
      publicDisplayName: order.publicDisplayName,
      publicAvatarSeed: order.publicAvatarSeed,
      publicAvatar: order.publicAvatar
    }));
  return <PickupDisplay orders={publicOrders} location={location} initialCursor={initialCursor} />;
}
