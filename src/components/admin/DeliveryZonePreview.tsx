import { MapPinned } from "lucide-react";
import type { DeliveryLocationSettings } from "@/lib/delivery/settings";
import type { Coordinate, PolygonGeometry } from "@/lib/delivery/geo";

const MAP_SIZE = 820;
const PAD = 55;
const WORLD_MIN_X = -4_500;
const WORLD_MAX_X = 4_500;
const WORLD_MIN_Y = -6_000;
const WORLD_MAX_Y = 3_000;

function localMeters(point: Coordinate, center: Coordinate): [number, number] {
  const latitude = center[1] * Math.PI / 180;
  return [
    (point[0] - center[0]) * 111_320 * Math.cos(latitude),
    (point[1] - center[1]) * 110_574
  ];
}

function project(point: Coordinate, center: Coordinate): [number, number] {
  const [x, y] = localMeters(point, center);
  return [
    PAD + ((x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X)) * MAP_SIZE,
    PAD + ((WORLD_MAX_Y - y) / (WORLD_MAX_Y - WORLD_MIN_Y)) * MAP_SIZE
  ];
}

function geometryRings(geometry: PolygonGeometry) {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function polygonPath(geometry: PolygonGeometry, center: Coordinate) {
  return geometryRings(geometry).map((ring) => ring.map((point, index) => {
    const [x, y] = project(point, center);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z").join(" ");
}

function worldPoint(x: number, y: number) {
  return [
    PAD + ((x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X)) * MAP_SIZE,
    PAD + ((WORLD_MAX_Y - y) / (WORLD_MAX_Y - WORLD_MIN_Y)) * MAP_SIZE
  ] as const;
}

export function DeliveryZonePreview({ settings }: { settings: DeliveryLocationSettings }) {
  const [centerX, centerY] = worldPoint(0, 0);
  const scale = MAP_SIZE / (WORLD_MAX_X - WORLD_MIN_X);
  const radius = settings.radiusMeters * scale;
  const mapHref = `https://yandex.ru/maps/?ll=${settings.center[0]}%2C${settings.center[1]}&z=13&pt=${settings.center[0]}%2C${settings.center[1]}`;

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden rounded-lg border border-karimoff-line bg-white" aria-labelledby="delivery-zone-map-title">
        <header className="border-b border-karimoff-line px-5 py-4">
          <h2 id="delivery-zone-map-title" className="font-black">Геометрия зоны</h2>
          <p className="mt-1 text-sm text-karimoff-muted">Схема в локальной проекции, север сверху. Масштаб показан в метрах.</p>
        </header>
        <div className="overflow-x-auto p-3 sm:p-5">
          <svg viewBox="0 0 930 930" role="img" aria-labelledby="delivery-zone-svg-title delivery-zone-svg-desc" className="mx-auto block w-full min-w-[420px] max-w-[760px]">
            <title id="delivery-zone-svg-title">Зона доставки и исключённая территория аэродрома</title>
            <desc id="delivery-zone-svg-desc">Круг радиусом {settings.radiusMeters} метров вокруг точки KARIMOFF, маркер точки и исключённый полигон аэродрома.</desc>
            <rect x="0" y="0" width="930" height="930" rx="8" fill="#f7faf9" />
            {Array.from({ length: 9 }, (_, index) => {
              const meter = -4_000 + index * 1_000;
              const [x] = worldPoint(meter, 0);
              const [, y] = worldPoint(0, meter);
              return <g key={meter}>
                <line x1={x} y1={PAD} x2={x} y2={PAD + MAP_SIZE} stroke="#dce6e2" strokeDasharray="3 6" />
                <line x1={PAD} y1={y} x2={PAD + MAP_SIZE} y2={y} stroke="#dce6e2" strokeDasharray="3 6" />
                <text x={x + 4} y={PAD + MAP_SIZE + 19} fontSize="11" fill="#62736d">{meter}</text>
                <text x={PAD - 7} y={y - 4} textAnchor="end" fontSize="11" fill="#62736d">{meter}</text>
              </g>;
            })}
            <circle cx={centerX} cy={centerY} r={radius} fill="#19a974" fillOpacity="0.12" stroke="#13845c" strokeWidth="3" />
            {settings.excludedAreas.map((area) => (
              <path key={area.name} d={polygonPath(area.geometry, settings.center)} fill="#de3c3c" fillOpacity="0.36" fillRule="evenodd" stroke="#a92222" strokeWidth="2.5" />
            ))}
            <line x1={centerX - 13} y1={centerY} x2={centerX + 13} y2={centerY} stroke="#111827" strokeWidth="2" />
            <line x1={centerX} y1={centerY - 13} x2={centerX} y2={centerY + 13} stroke="#111827" strokeWidth="2" />
            <circle cx={centerX} cy={centerY} r="7" fill="#ff6b00" stroke="white" strokeWidth="3" />
            <text x={centerX + 14} y={centerY - 13} fontSize="14" fontWeight="700" fill="#111827">KARIMOFF</text>
            <text x="465" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill="#62736d">СЕВЕР ↑</text>
            <text x="465" y="915" textAnchor="middle" fontSize="11" fill="#62736d">МЕТРЫ ОТ ЦЕНТРА</text>
          </svg>
        </div>
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
