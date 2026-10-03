import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { normalizeHouse, normalizeStreet } from "./address-normalization.mjs";
import { deliveryAddressText } from "./address-geometry.mjs";

export type DeliveryAddressRecord = {
  id: string;
  location_id: string;
  city: string | null;
  street: string;
  street_normalized: string;
  house: string;
  house_normalized: string;
  building: string;
  building_normalized: string;
  display_name: string | null;
  postal_code: string | null;
  latitude: number | string;
  longitude: number | string;
  distance_meters: number;
  aerodrome_boundary_distance_meters: number | null;
  source: string;
  source_id: string | null;
  source_ids: string[];
  source_snapshot_version: string | null;
  is_available: boolean;
  disabled_reason: string | null;
  review_reasons: string[];
  duplicate_count: number;
};

export type DeliveryAddressOption = { id: string; label: string };

const genericUnavailableMessage = "По этому адресу доставка пока недоступна. Вы можете выбрать другой адрес или оформить самовывоз.";

export function isAvailableDeliveryAddress(
  address: Pick<DeliveryAddressRecord, "id" | "location_id" | "is_available"> | null | undefined,
  requestedId: string,
  locationId: string
) {
  return Boolean(address && address.id === requestedId
    && address.location_id === locationId && address.is_available === true);
}

export function formatDeliveryHouse(address: Pick<DeliveryAddressRecord, "house" | "building" | "display_name">) {
  if (address.display_name?.trim()) return address.display_name.trim();
  return [address.house, address.building ? `корп. ${address.building}` : ""].filter(Boolean).join(", ");
}

export function formatDeliveryAddress(address: Pick<DeliveryAddressRecord,
  "street" | "house" | "building" | "display_name">) {
  if (address.display_name?.trim()) return `${address.street}, ${address.display_name.trim()}`;
  return deliveryAddressText(address);
}

export async function getDefaultDeliveryLocationId() {
  const sql = getPostgresSql();
  const [location] = await sql<{ id: string }[]>`
    select id from public.order_locations
    where location_key = 'karimoff-main' and is_default and is_active
    order by created_at limit 1
  `;
  return location?.id ?? null;
}

export async function hasAvailableDeliveryAddresses(locationId: string) {
  const sql = getPostgresSql();
  const [result] = await sql<{ available: boolean }[]>`
    select exists (
      select 1 from public.delivery_addresses
      where location_id = ${locationId}::uuid and is_available
    ) as available
  `;
  return Boolean(result?.available);
}

export async function searchDeliveryStreets(locationId: string, query: string, limit = 10) {
  const normalizedQuery = normalizeStreet(query);
  if (!normalizedQuery) return [];
  const sql = getPostgresSql();
  const pattern = `%${normalizedQuery}%`;
  return sql<{ street: string; street_normalized: string }[]>`
    select min(street) as street, street_normalized
    from public.delivery_addresses
    where location_id = ${locationId}::uuid and is_available
      and street_normalized like ${pattern}
    group by street_normalized
    order by min(street)
    limit ${Math.max(1, Math.min(limit, 20))}
  `;
}

export async function listDeliveryHouses(locationId: string, street: string) {
  const streetNormalized = normalizeStreet(street);
  if (!streetNormalized) return [];
  const sql = getPostgresSql();
  const records = await sql<DeliveryAddressOption[]>`
    select id, coalesce(nullif(display_name, ''), house ||
      case when nullif(btrim(building), '') is not null then ', корп. ' || btrim(building) else '' end) as label
    from public.delivery_addresses
    where location_id = ${locationId}::uuid and street_normalized = ${streetNormalized}
      and is_available
    order by house_normalized, building_normalized
    limit 300
  `;
  return records;
}

export async function findDeliveryAddressById(id: string, locationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const sql = getPostgresSql();
  const [address] = await sql<DeliveryAddressRecord[]>`
    select id, location_id, city, street, street_normalized, house, house_normalized,
      building, building_normalized, display_name, postal_code, latitude, longitude,
      distance_meters, aerodrome_boundary_distance_meters, source, source_id, source_ids,
      source_snapshot_version, is_available, disabled_reason, review_reasons, duplicate_count
    from public.delivery_addresses
    where id = ${id}::uuid and location_id = ${locationId}::uuid
    limit 1
  `;
  return address ?? null;
}

export function unavailableDeliveryAddressMessage() {
  return genericUnavailableMessage;
}

export function normalizeDeliveryAddressSearch(value: string) {
  return { street: normalizeStreet(value), house: normalizeHouse(value) };
}
