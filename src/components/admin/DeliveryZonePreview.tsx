import { MapPinned } from "lucide-react";
import type { DeliveryLocationSettings } from "@/lib/delivery/settings";
import { DeliveryZoneMap } from "./DeliveryZoneMap";

export function DeliveryZonePreview({ settings }: { settings: DeliveryLocationSettings }) {
  const mapHref = `https://yandex.ru/maps/?ll=${settings.center[0]}%2C${settings.center[1]}&z=13&pt=${settings.center[0]}%2C${settings.center[1]}`;

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden rounded-lg border border-karimoff-line bg-white" aria-labelledby="delivery-zone-map-title">
        <header className="border-b border-karimoff-line px-5 py-4">
          <h2 id="delivery-zone-map-title" className="font-black">Геометрия зоны</h2>
          <p className="mt-1 text-sm text-karimoff-muted">Радиус по прямой и исключённая территория. Контур требует ручного подтверждения.</p>
        </header>
        <DeliveryZoneMap settings={settings} />
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-karimoff-line px-5 py-4 text-sm">
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-full border-2 border-emerald-700 bg-emerald-500/20" /> Доставка в радиусе</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm border border-red-800 bg-red-500/40" /> Исключённая территория</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-full bg-karimoff-orange" /> Точка KARIMOFF</span>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-karimoff-line bg-white p-5">
          <h2 className="font-black">Параметры точки</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-karimoff-muted">Адрес</dt><dd className="mt-1 font-semibold">{settings.locationName}</dd></div>
            <div><dt className="text-karimoff-muted">Координаты центра</dt><dd className="mt-1 font-mono">{settings.center[1].toFixed(6)}, {settings.center[0].toFixed(6)}</dd></div>
            <div><dt className="text-karimoff-muted">Радиус по прямой</dt><dd className="mt-1 font-semibold">{settings.radiusMeters.toLocaleString("ru-RU")} м, граница включена</dd></div>
            <div><dt className="text-karimoff-muted">Исключения</dt><dd className="mt-1 font-semibold">{settings.excludedAreas.map((area) => area.name).join(", ") || "Не настроены"}</dd></div>
          </dl>
          <a href={mapHref} target="_blank" rel="noreferrer" className="admin-secondary-button mt-5 w-full justify-center">
            <MapPinned size={16} /> Сверить точку в Яндекс Картах
          </a>
        </section>
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
          <h2 className="font-black">Контур требует ручной сверки</h2>
          <p className="mt-2 leading-6">Исключённая территория загружена как GeoJSON-полигон. Источник контура: {settings.excludedAreas[0]?.source ?? "не указан"}. Сравните красный контур с границей аэродрома на Яндекс Картах; до подтверждения доставки остаются выключенными.</p>
        </section>
      </aside>
    </div>
  );
}
