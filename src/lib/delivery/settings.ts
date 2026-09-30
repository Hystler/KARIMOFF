import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import type { PolygonGeometry } from "./geo";
import type { DeliveryHours } from "./hours";

export type DeliveryLocationSettings = DeliveryHours & {
  locationId: string;
  locationKey: string;
  locationName: string;
  enabled: boolean;
  center: [longitude: number, latitude: number];
  radiusMeters: number;
  excludedAreas: Array<{ name: string; source: string | null; geometry: PolygonGeometry }>;
  deliveryFee: number;
  freeThreshold: number;
  etaMinutes: number;
};

export async function getDeliveryLocationSettings(locationKey = "karimoff-main"): Promise<DeliveryLocationSettings | null> {
  try {
    const sql = getPostgresSql();
    const rows = await sql.unsafe<Array<{
    location_id: string;
    location_key: string;
    location_name: string;
    enabled: boolean;
    center_longitude: string | number;
    center_latitude: string | number;
    radius_meters: number;
    excluded_areas: Array<{ name?: string; source?: string; geojson?: PolygonGeometry }>;
    delivery_fee: string | number;
    free_threshold: string | number;
    acceptance_start: string;
    acceptance_end: string;
    timezone: string;
    eta_minutes: number;
    }>>(`
      select settings.location_id, location.location_key, location.name as location_name,
        settings.enabled, settings.center_longitude, settings.center_latitude,
        settings.radius_meters, settings.excluded_areas, settings.delivery_fee,
        settings.free_threshold, settings.acceptance_start::text, settings.acceptance_end::text,
        settings.timezone, settings.eta_minutes
      from public.delivery_location_settings settings
      join public.order_locations location on location.id = settings.location_id
      where location.location_key = $1 and location.is_active
      limit 1
    `, [locationKey]);
    const row = rows[0];
    if (!row) return null;

    const excludedAreas = Array.isArray(row.excluded_areas)
      ? row.excluded_areas.flatMap((area) => area?.name && area.geojson ? [{ name: area.name, source: area.source ?? null, geometry: area.geojson }] : [])
      : [];
    if (excludedAreas.length !== (row.excluded_areas?.length ?? 0)) return null;

    const center: [number, number] = [Number(row.center_longitude), Number(row.center_latitude)];
    if (!center.every(Number.isFinite) || !Number.isFinite(Number(row.radius_meters)) || Number(row.radius_meters) <= 0) return null;
    return {
      locationId: row.location_id,
      locationKey: row.location_key,
      locationName: row.location_name,
      enabled: row.enabled,
      center,
      radiusMeters: Number(row.radius_meters),
      excludedAreas,
      deliveryFee: Number(row.delivery_fee),
      freeThreshold: Number(row.free_threshold),
      acceptanceStart: row.acceptance_start.slice(0, 5),
      acceptanceEnd: row.acceptance_end.slice(0, 5),
      timezone: row.timezone,
      etaMinutes: row.eta_minutes
    };
  } catch {
    // A missing/unfinished delivery migration must never make checkout fail open.
    return null;
  }
}
