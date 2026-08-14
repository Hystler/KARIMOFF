import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PosWorkspace } from "@/components/operations/PosWorkspace";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { canCreatePosOrder } from "@/lib/order-flow/permissions";
import { getActiveProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login?redirectTo=/pos");
  if (!canCreatePosOrder(staff.role)) redirect("/kitchen");
  const [products, locations] = await Promise.all([
    getActiveProducts(250),
    getAccessibleOrderLocations(staff)
  ]);
  const location = locations.find((item) => item.isDefault) ?? locations[0];
  if (!location) throw new Error("Не настроена точка продаж.");
  return (
    <PosWorkspace
      products={products}
      locations={locations}
      initialLocationId={location.id}
      initialIdempotencyKey={randomUUID()}
      staffName={staff.name}
    />
  );
}
