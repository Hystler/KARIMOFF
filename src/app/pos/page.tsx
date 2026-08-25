import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PosWorkspace } from "@/components/operations/PosWorkspace";
import { OperationsUnavailable } from "@/components/operations/OperationsUnavailable";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { canCreatePosOrder } from "@/lib/order-flow/permissions";
import { getActiveProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login?redirectTo=/pos");
  if (!canCreatePosOrder(staff.role)) redirect("/kitchen");
  let products;
  let locations;
  try {
    [products, locations] = await Promise.all([
      getActiveProducts(250),
      getAccessibleOrderLocations(staff)
    ]);
  } catch {
    return <OperationsUnavailable title="POS временно недоступен" message="Не удалось загрузить меню и точку. Проверьте связь и повторите." />;
  }
  const location = locations.find((item) => item.isDefault) ?? locations[0];
  if (!location) return <OperationsUnavailable title="Не настроена точка продаж" message="Добавьте активную точку в настройках ERP." />;
  return (
    <PosWorkspace
      products={products}
      locations={locations}
      initialLocationId={location.id}
      initialIdempotencyKey={randomUUID()}
      staffName={staff.name}
      testMode={process.env.TEST_ORDER_MODE === "true"}
    />
  );
}
