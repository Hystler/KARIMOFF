import { redirect } from "next/navigation";
import { KitchenWorkspace } from "@/components/operations/KitchenWorkspace";
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
  const locations = await getAccessibleOrderLocations(staff);
  const location = locations.find((item) => item.id === params.location || item.key === params.location)
    ?? locations.find((item) => item.isDefault)
    ?? locations[0];
  if (!location) throw new Error("Не настроена точка кухни.");
  const [orders, sla, initialCursor] = await Promise.all([
    getOrderFlowQueue({ locationId: location.id }),
    getKitchenSla(location.id),
    getLatestOrderEventCursor(location.id)
  ]);
  const metrics = await getKitchenOperationsMetrics(location.id, sla);
  return <KitchenWorkspace orders={orders.filter((order) => isOrderVisibleToKitchen(order, sla))} location={location} locations={locations} sla={sla} metrics={metrics} role={staff.role} staffName={staff.name} initialCursor={initialCursor} />;
}
