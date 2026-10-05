import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PosWorkspace } from "@/components/operations/PosWorkspace";
import { OperationsUnavailable } from "@/components/operations/OperationsUnavailable";
import { getCurrentStaff } from "@/lib/admin-auth";
import { evotorPosPaymentsEnabled, getActiveEvotorPosPayment } from "@/lib/integrations/evotor/pos-payments";
import { getTerminalBridgeDevices } from "@/lib/integrations/evotor/terminal-bridge";
import { getAccessibleOrderLocations } from "@/lib/order-flow/access";
import { canCreatePosOrder } from "@/lib/order-flow/permissions";
import { getActiveProducts } from "@/lib/products";
import { logOperationalError } from "@/lib/observability";

export const dynamic = "force-dynamic";

async function loadPosResource<T>(resource: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    logOperationalError("pos.page_load_failed", {
      resource,
      error_type: error instanceof Error && ["Error", "PostgresError", "TypeError"].includes(error.name)
        ? error.name : "UnknownError",
      error_code: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined
    });
    throw error;
  }
}

export default async function PosPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login?redirectTo=/pos");
  if (!canCreatePosOrder(staff.role)) redirect("/kitchen");
  const paymentsEnabled = evotorPosPaymentsEnabled();
  let products;
  let locations;
  let initialPayment: Awaited<ReturnType<typeof getActiveEvotorPosPayment>> = null;
  let terminals: Awaited<ReturnType<typeof getTerminalBridgeDevices>> = [];
  try {
    [products, locations] = await Promise.all([
      loadPosResource("products", () => getActiveProducts(250)),
      loadPosResource("locations", () => getAccessibleOrderLocations(staff))
    ]);
  } catch {
    return <OperationsUnavailable title="POS временно недоступен" message="Не удалось загрузить меню и точку. Проверьте связь и повторите." />;
  }
  const location = locations.find((item) => item.isDefault) ?? locations[0];
  if (!location) return <OperationsUnavailable title="Не настроена точка продаж" message="Добавьте активную точку в настройках ERP." />;
  if (paymentsEnabled) {
    const locationIds = locations.map((item) => item.id);
    try {
      initialPayment = await loadPosResource("active_payment", () => getActiveEvotorPosPayment(locationIds));
      terminals = await loadPosResource("terminals", () => getTerminalBridgeDevices(locationIds));
    } catch {
      return <OperationsUnavailable title="POS временно недоступен" message="Не удалось загрузить состояние кассы. Проверьте связь и повторите." />;
    }
  }
  return (
    <PosWorkspace
      products={products}
      locations={locations}
      initialTerminals={terminals}
      initialLocationId={location.id}
      initialIdempotencyKey={randomUUID()}
      staffName={staff.name}
      testMode={process.env.TEST_ORDER_MODE === "true"}
      paymentsEnabled={paymentsEnabled}
      initialPayment={initialPayment ? {
        intentId: initialPayment.intentId,
        orderId: initialPayment.orderId,
        displayNumber: initialPayment.displayNumber,
        status: initialPayment.status,
        amount: initialPayment.amount,
        result: initialPayment.result
      } : null}
    />
  );
}
