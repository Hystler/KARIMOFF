const STREET_PREFIX = /^(?:улица|ул\.?)(?:\s+|$)/iu;

/** Normalize Russian street variants for local address search. */
export function normalizeStreet(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(STREET_PREFIX, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** Normalize house labels without merging materially different buildings. */
export function normalizeHouse(value) {
  let normalized = String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLocaleUpperCase("ru-RU")
    .replace(/Ё/g, "Е")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");

  normalized = normalized
    .replace(/^(\d+)\s+([А-Я])$/u, "$1$2")
    .replace(/^(\d+)\s*К\s*(\d+)$/u, "$1К$2");

  return normalized;
}

export function normalizeBuilding(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLocaleUpperCase("ru-RU")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ");
}

export function makeAddressKey({ locationId, street, house, building = "" }) {
  return [locationId, normalizeStreet(street), normalizeHouse(house), normalizeBuilding(building)].join("\u001f");
}
