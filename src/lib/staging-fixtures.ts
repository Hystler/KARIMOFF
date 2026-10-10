import "server-only";

import { createHash } from "node:crypto";
import snapshot from "../../data/staging/approved-addresses.json";
import aerodrome from "../../data/staging/aerodrome.json";
import { demoProducts } from "@/data/products";
import { isPublicMenuCategory } from "@/lib/product-categories";
import { isStagingFixtureMode } from "@/lib/staging-ui-mode";
import { normalizeHouse, normalizeStreet } from "./delivery/address-normalization.mjs";
import { distanceMeters, type PolygonGeometry } from "./delivery/geo";
import type { DeliveryAddressRecord } from "./delivery/address-whitelist";
import type { DeliveryLocationSettings } from "./delivery/settings";
import type { CreateOrderInput } from "./order-schema";

// Namespaced, deterministic IDs belong only to this public fixture snapshot.
function fixtureId(value: string) {
  const hash = createHash("sha256").update(`karimoff-staging-fixture:${value}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export const fixtureLocationId = fixtureId("location:karimoff-main");
const center: [number, number] = [38.0557080, 55.9092210];
const products = demoProducts.filter(product => product.is_active && isPublicMenuCategory(product.category))
  .map(product => ({ ...product, id: fixtureId(`product:${product.slug}`) }));
const productsById = new Map(products.map(product => [product.id, product]));
const addresses: DeliveryAddressRecord[] = snapshot.addresses.map(address => ({
  ...address,
  id: fixtureId(`address:${JSON.stringify(address)}`),
  location_id: fixtureLocationId,
  street_normalized: normalizeStreet(address.street),
  house_normalized: normalizeHouse(address.house),
  building_normalized: normalizeHouse(address.building),
  display_name: null,
  postal_code: null,
  distance_meters: Math.round(distanceMeters(center, [Number(address.longitude), Number(address.latitude)])),
  aerodrome_boundary_distance_meters: null,
  source: "openstreetmap",
  source_ids: address.source_id ? [address.source_id] : [],
  is_available: true,
  disabled_reason: null,
  review_reasons: [],
  duplicate_count: 1
}));

function requireFixtureMode() {
  if (!isStagingFixtureMode()) throw new Error("Staging fixtures require STAGING_UI_MODE=true and STAGING_DATA_MODE=fixture.");
}

export function getFixtureProducts() {
  requireFixtureMode();
  return products;
}

export function getFixtureAddresses(locationId: string) {
  requireFixtureMode();
  return locationId === fixtureLocationId ? addresses : [];
}

export function getFixtureOpenData() {
  requireFixtureMode();
  return snapshot;
}

export function getFixtureDeliverySettings(): DeliveryLocationSettings {
  requireFixtureMode();
  return {
    locationId: fixtureLocationId, locationKey: "karimoff-main", locationName: "Бахчиванджи 5Б",
    enabled: process.env.DELIVERY_ENABLED === "true", center, radiusMeters: 3000,
    excludedAreas: [{ name: "Аэродром Чкаловский", source: "OpenStreetMap relation 3300255", geometry: aerodrome as PolygonGeometry }],
    deliveryFee: 200, freeThreshold: 2500, etaMinutes: 60,
    timezone: "Europe/Moscow", acceptanceStart: "11:00", acceptanceEnd: "20:30"
  };
}

export function validateFixtureCart(cart: CreateOrderInput["cart"]) {
  requireFixtureMode();
  // This public demo catalog has no ingredient/modifier snapshot. Unknown IDs
  // must be rejected, not accepted merely because they look like UUIDs.
  for (const line of cart) {
    if (!productsById.has(line.product_id) || line.removed_ingredient_ids.length
      || line.extras.length || line.modifier_option_ids.length) return null;
  }
  return cart.reduce((total, line) => total + productsById.get(line.product_id)!.price * line.quantity, 0);
}
