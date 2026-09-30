import "server-only";

import type { Coordinate } from "./geo";

type AddressComponent = { kind: string; name: string };

type GeocoderFeature = {
  GeoObject?: {
    metaDataProperty?: {
      GeocoderMetaData?: {
        kind?: string;
        precision?: string;
        text?: string;
        Address?: { country_code?: string; formatted?: string; Components?: AddressComponent[] };
      };
    };
    Point?: { pos?: string };
  };
};

function readKey(name: "YANDEX_GEOCODER_API_KEY" | "YANDEX_SUGGEST_API_KEY") {
  const key = process.env[name]?.trim();
  if (!key) throw new Error("YANDEX_MAPS_NOT_CONFIGURED");
  return key;
}

async function readJson(url: URL) {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error("YANDEX_MAPS_UNAVAILABLE");
  }
  if (!response.ok) throw new Error(response.status === 429 ? "YANDEX_MAPS_RATE_LIMITED" : "YANDEX_MAPS_UNAVAILABLE");
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new Error("YANDEX_MAPS_UNAVAILABLE");
  }
}

export type DeliveryAddressSuggestion = {
  label: string;
  street: string;
  house: string;
  uri: string;
};

export async function suggestDeliveryAddresses(query: string, center: Coordinate): Promise<DeliveryAddressSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 3 || normalized.length > 160) return [];

  const url = new URL("https://suggest-maps.yandex.ru/v1/suggest");
  url.search = new URLSearchParams({
    apikey: readKey("YANDEX_SUGGEST_API_KEY"),
    attrs: "uri",
    countries: "ru",
    lang: "ru_RU",
    ll: `${center[0]},${center[1]}`,
    print_address: "1",
    results: "7",
    spn: "0.12,0.08",
    strict_bounds: "1",
    text: normalized,
    types: "street,house"
  }).toString();

  const payload = await readJson(url);
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const result = item as {
      title?: { text?: string };
      uri?: string;
      address?: { formatted_address?: string; component?: Array<{ kind?: string[]; name?: string }> };
    };
    const components = result.address?.component ?? [];
    const street = components.find((component) => component.kind?.includes("STREET"))?.name ?? "";
    const house = components.find((component) => component.kind?.includes("HOUSE"))?.name ?? "";
    const label = result.address?.formatted_address || result.title?.text || "";
    return label && street && house && typeof result.uri === "string"
      ? [{ label: label.slice(0, 220), street: street.slice(0, 120), house: house.slice(0, 30), uri: result.uri.slice(0, 500) }]
      : [];
  }).slice(0, 7);
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/[ё]/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function geocodeDeliveryAddress(query: string) {
  const normalized = query.trim();
  if (normalized.length < 5 || normalized.length > 240) throw new Error("DELIVERY_ADDRESS_AMBIGUOUS");

  const url = new URL("https://geocode-maps.yandex.ru/v1/");
  url.search = new URLSearchParams({
    apikey: readKey("YANDEX_GEOCODER_API_KEY"),
    geocode: normalized,
    lang: "ru_RU",
    format: "json",
    results: "3"
  }).toString();
  const payload = await readJson(url);
  const response = payload.response as { GeoObjectCollection?: { featureMember?: GeocoderFeature[] } } | undefined;
  const features = response?.GeoObjectCollection?.featureMember ?? [];
  const candidate = features[0]?.GeoObject;
  const metadata = candidate?.metaDataProperty?.GeocoderMetaData;
  const address = metadata?.Address;
  const components = address?.Components ?? [];
  const country = normalize(components.find((component) => component.kind === "country")?.name ?? "");
  const region = normalize(components.find((component) => component.kind === "province" || component.kind === "area")?.name ?? "");
  const house = components.find((component) => component.kind === "house")?.name ?? "";
  const street = components.find((component) => component.kind === "street")?.name ?? "";
  const position = candidate?.Point?.pos?.split(/\s+/).map(Number);

  if (country !== "россия" || region !== "московская область"
    || metadata?.kind !== "house" || metadata.precision !== "exact"
    || !house || !street || !position || position.length !== 2
    || !position.every(Number.isFinite)) {
    throw new Error("DELIVERY_ADDRESS_AMBIGUOUS");
  }

  return {
    addressText: (address?.formatted || metadata.text || normalized).slice(0, 300),
    coordinates: [position[0], position[1]] as Coordinate,
    region: "Московская область",
    street,
    house
  };
}
