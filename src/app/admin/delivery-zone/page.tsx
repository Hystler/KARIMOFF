import { CircleAlert, MapPinned } from "lucide-react";
import { redirect } from "next/navigation";
import { DeliveryZonePreview } from "@/components/admin/DeliveryZonePreview";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getDeliveryLocationSettings } from "@/lib/delivery/settings";

export const dynamic = "force-dynamic";

export default async function DeliveryZonePage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin"].includes(staff.role)) redirect("/admin");

  const settings = await getDeliveryLocationSettings();
  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Доставка · проверка конфигурации</p>
          <h1 className="flex items-center gap-3"><MapPinned size={27} />Зона доставки</h1>
          <p>Контроль центра, радиуса и закрытой территории до включения заказов.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">
          <CircleAlert size={16} /> Доставка выключена
        </span>
      </header>
      {settings ? (
        <DeliveryZonePreview settings={settings} />
      ) : (
        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
          Настройки зоны не найдены. Убедитесь, что схема доставки применена и точка KARIMOFF активна.
        </section>
      )}
    </main>
  );
}
