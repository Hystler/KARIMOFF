"use client";

import { useEffect, useRef, useState } from "react";
import type { DeliveryLocationSettings } from "@/lib/delivery/settings";
import "leaflet/dist/leaflet.css";
import styles from "./DeliveryZoneMap.module.css";

export function DeliveryZoneMap({ settings }: { settings: DeliveryLocationSettings }) {
  const container = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import("leaflet").then((L) => {
      if (disposed || !container.current) return;
      const center: [number, number] = [settings.center[1], settings.center[0]];
      const map = L.map(container.current, {
        minZoom: 10, maxZoom: 18, zoomControl: false,
        scrollWheelZoom: false, renderer: L.canvas(), attributionControl: false
      });
      cleanup = () => map.remove();
      map.fitBounds(L.latLng(center).toBounds(settings.radiusMeters * 2), { padding: [20, 20] });
      L.control.zoom({ zoomInTitle: "Приблизить", zoomOutTitle: "Отдалить" }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      L.control.attribution({ prefix: false }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ODbL',
        maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin"
      }).on("tileerror", () => { if (!disposed) setUnavailable(true); }).addTo(map);
      L.circle(center, { radius: settings.radiusMeters, color: "#16804e", fillOpacity: .12, weight: 2 }).addTo(map);
      for (const area of settings.excludedAreas) {
        const label = document.createElement("span");
        label.textContent = area.name;
        L.geoJSON(area.geometry, {
          style: { color: "#b92336", fillColor: "#de3c3c", fillOpacity: .3, weight: 2 }
        }).bindTooltip(label).addTo(map);
      }
      L.circleMarker(center, { radius: 7, color: "#fff", fillColor: "#e85c06", fillOpacity: 1, weight: 2 })
        .bindTooltip("KARIMOFF", { permanent: true, direction: "top" }).addTo(map);
      const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      resize.observe(container.current);
      cleanup = () => { resize.disconnect(); map.remove(); };
    }).catch(() => { cleanup?.(); cleanup = undefined; if (!disposed) setUnavailable(true); });
    return () => { disposed = true; cleanup?.(); };
  }, [settings]);

  return <div className={styles.frame}>
    <div ref={container} className={styles.map} role="region" aria-label="Карта зоны доставки: улицы, радиус и исключённая территория" />
    {unavailable ? <p className={styles.notice} role="status">Карта улиц временно недоступна. Для сверки воспользуйтесь ссылкой на внешнюю карту.</p> : null}
  </div>;
}
