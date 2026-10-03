import {
  makeAddressKey,
  normalizeBuilding,
  normalizeHouse,
  normalizeStreet
} from "./address-normalization.mjs";
import {
  AERODROME_POLYGON,
  DELIVERY_CENTER,
  DELIVERY_RADIUS_METERS,
  assessDeliveryPoint,
  haversineMeters
} from "./address-geometry.mjs";

export const DUPLICATE_COORDINATE_CONFLICT_METERS = 30;
export const AUTO_APPROVAL_MAX_DISTANCE_METERS = 2800;
export const AERODROME_BOUNDARY_REVIEW_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_008.8;

function finiteCoordinates(value) {
  return Number.isFinite(value?.[0]) && Number.isFinite(value?.[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function coordinatesForElement(element) {
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [element.lon, element.lat];
  if (Number.isFinite(element.center?.lon) && Number.isFinite(element.center?.lat)) {
    return [element.center.lon, element.center.lat];
  }
  return null;
}

function addressFromElement(element) {
  const tags = element.tags ?? {};
  const street = String(tags["addr:street"] ?? tags["addr:place"] ?? "").trim();
  const house = String(tags["addr:housenumber"] ?? "").trim();
  const building = String(tags["addr:corpus"] ?? tags["addr:building:ref"] ?? "").trim();
  const city = String(tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"] ?? "").trim() || null;
  const flags = [];
  const streetNormalized = normalizeStreet(street);
  const houseNormalized = normalizeHouse(house);
  const buildingNormalized = normalizeBuilding(building);
  const coordinates = coordinatesForElement(element);

  if (!streetNormalized) flags.push("MISSING_STREET");
  if (!houseNormalized) flags.push("MISSING_HOUSE");
  if (!coordinates) flags.push("MISSING_COORDINATES");
  else if (!finiteCoordinates(coordinates)) flags.push("INVALID_COORDINATES");
  if (/[;,]/u.test(house)) flags.push("MULTIPLE_HOUSE_NUMBERS");
  if (house && !/^[\p{L}\p{N}]+(?:[\s/-]+[\p{L}\p{N}]+)*(?:\s*[Кк]\s*\d+)?$/u.test(house)) {
    flags.push("SUSPICIOUS_HOUSE_FORMAT");
  }
  if (street && /[<>\[\]{}]/u.test(street)) flags.push("SUSPICIOUS_STREET_FORMAT");

  return {
    city,
    street,
    street_normalized: streetNormalized,
    house,
    house_normalized: houseNormalized,
    building,
    building_normalized: buildingNormalized,
    postal_code: String(tags["addr:postcode"] ?? "").trim() || null,
    latitude: finiteCoordinates(coordinates) ? coordinates[1] : null,
    longitude: finiteCoordinates(coordinates) ? coordinates[0] : null,
    source: "openstreetmap",
    source_id: `${element.type}/${element.id}`,
    osm_element_type: element.type,
    tags,
    flags: [...new Set(flags)]
  };
}

function naturalKey(record, locationId) {
  return makeAddressKey({
    locationId,
    street: record.street_normalized,
    house: record.house_normalized,
    building: record.building_normalized
  });
}

function coordinateSpread(records) {
  let maximum = 0;
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      maximum = Math.max(maximum, haversineMeters(
        [records[left].longitude, records[left].latitude],
        [records[right].longitude, records[right].latitude]
      ));
    }
  }
  return maximum;
}

function coordinateMedoid(records) {
  return [...records].sort((left, right) => {
    const leftTotal = records.reduce((sum, candidate) => sum + haversineMeters(
      [left.longitude, left.latitude], [candidate.longitude, candidate.latitude]
    ), 0);
    const rightTotal = records.reduce((sum, candidate) => sum + haversineMeters(
      [right.longitude, right.latitude], [candidate.longitude, candidate.latitude]
    ), 0);
    return leftTotal - rightTotal || left.source_id.localeCompare(right.source_id);
  })[0];
}

function chooseLabel(records, field) {
  const counts = new Map();
  for (const record of records) {
    const value = record[field]?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].length - right[0].length || left[0].localeCompare(right[0], "ru")
  )[0]?.[0] ?? "";
}

function mergeAddressGroup(key, group) {
  const ordered = [...group].sort((left, right) => left.source_id.localeCompare(right.source_id));
  const withCoordinates = ordered.filter((record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude));
  const coordinateSpreadMeters = coordinateSpread(withCoordinates);
  const representative = withCoordinates.length ? coordinateMedoid(withCoordinates) : ordered[0];
  const flags = new Set(ordered.flatMap((record) => record.flags.filter((flag) => flag !== "MISSING_COORDINATES")));
  if (!withCoordinates.length) flags.add("MISSING_COORDINATES");
  if (coordinateSpreadMeters > DUPLICATE_COORDINATE_CONFLICT_METERS) {
    flags.add("DUPLICATE_COORDINATE_CONFLICT");
  }

  return {
    ...representative,
    city: chooseLabel(ordered, "city") || null,
    street: chooseLabel(ordered, "street"),
    house: chooseLabel(ordered, "house"),
    building: chooseLabel(ordered, "building"),
    postal_code: chooseLabel(ordered, "postal_code") || null,
    latitude: representative.latitude,
    longitude: representative.longitude,
    address_key: key,
    source_ids: ordered.map((record) => record.source_id),
    duplicate_count: ordered.length,
    coordinate_spread_meters: Math.round(coordinateSpreadMeters * 10) / 10,
    flags: [...flags].sort()
  };
}

function canonicalizeStreetLabels(records) {
  const variants = new Map();
  for (const record of records) {
    const group = variants.get(record.street_normalized) ?? new Map();
    group.set(record.street, (group.get(record.street) ?? 0) + record.duplicate_count);
    variants.set(record.street_normalized, group);
  }
  const canonicalByKey = new Map([...variants].map(([key, names]) => [
    key,
    [...names].sort((left, right) =>
      right[1] - left[1] || left[0].length - right[0].length || left[0].localeCompare(right[0], "ru")
    )[0]?.[0] ?? ""
  ]));
  return records.map((record) => ({
    ...record,
    street: canonicalByKey.get(record.street_normalized) ?? record.street
  }));
}

function assessRecord(record) {
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) {
    return {
      ...record,
      distance_meters: null,
      boundary_distance_meters: null,
      excluded_by_aerodrome: false,
      in_radius: false,
      classification: record.flags.some((flag) => flag === "MISSING_STREET" || flag === "MISSING_HOUSE")
        ? "SUSPICIOUS"
        : "MANUAL REVIEW",
      review_reasons: [...record.flags]
    };
  }

  const coordinates = [record.longitude, record.latitude];
  const assessment = assessDeliveryPoint(coordinates);
  const distance = assessment.distanceMeters;
  const boundaryDistance = assessment.boundaryDistanceMeters;
  const reasons = [...record.flags];
  if (distance >= AUTO_APPROVAL_MAX_DISTANCE_METERS && distance <= DELIVERY_RADIUS_METERS) {
    reasons.push("DELIVERY_RADIUS_REVIEW_2800_3000M");
  }
  if (boundaryDistance <= AERODROME_BOUNDARY_REVIEW_METERS) {
    reasons.push("AERODROME_BOUNDARY_WITHIN_100M");
  }
  if (assessment.excludedByAerodrome) reasons.push("INSIDE_OR_ON_AERODROME_BOUNDARY");
  if (distance > DELIVERY_RADIUS_METERS) reasons.push("OUTSIDE_3KM_RADIUS");

  let classification = "AUTO-APPROVABLE";
  if (distance > DELIVERY_RADIUS_METERS || assessment.excludedByAerodrome) classification = "OUTSIDE ZONE";
  else if (reasons.some((reason) => reason !== "AERODROME_BOUNDARY_WITHIN_100M"
      && reason !== "DELIVERY_RADIUS_REVIEW_2800_3000M")
    || distance >= AUTO_APPROVAL_MAX_DISTANCE_METERS
    || boundaryDistance <= AERODROME_BOUNDARY_REVIEW_METERS) {
    classification = "MANUAL REVIEW";
  }

  return {
    ...record,
    latitude: Number(record.latitude.toFixed(7)),
    longitude: Number(record.longitude.toFixed(7)),
    distance_meters: Math.round(distance),
    distance_meters_precise: Math.round(distance * 10) / 10,
    boundary_distance_meters: Math.round(boundaryDistance * 10) / 10,
    excluded_by_aerodrome: assessment.excludedByAerodrome,
    in_radius: assessment.inRadius,
    classification,
    review_reasons: [...new Set(reasons)].sort()
  };
}

export function buildAddressSnapshot(raw, { locationId = "karimoff-main", importedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(raw?.elements)) throw new Error("The Overpass response has no elements array.");
  const groups = new Map();
  const suspiciousObjects = [];
  let rawWithoutCoordinates = 0;

  for (const element of raw.elements) {
    const record = addressFromElement(element);
    if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) rawWithoutCoordinates += 1;
    if (!record.street_normalized || !record.house_normalized) {
      suspiciousObjects.push(record);
      continue;
    }
    const key = naturalKey(record, locationId);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const unique = canonicalizeStreetLabels([...groups].map(([key, group]) => mergeAddressGroup(key, group)))
    .map(assessRecord);
  const suspiciousAddresses = unique.filter((record) =>
    record.flags.some((flag) => flag.startsWith("SUSPICIOUS_") || flag === "MULTIPLE_HOUSE_NUMBERS")
  );
  const autoApprovable = unique.filter((record) => record.classification === "AUTO-APPROVABLE");
  const manualReview = unique.filter((record) => record.classification === "MANUAL REVIEW");
  const outsideZone = unique.filter((record) => record.classification === "OUTSIDE ZONE");
  const nearAerodrome = unique.filter((record) => Number.isFinite(record.boundary_distance_meters)
    && record.boundary_distance_meters <= AERODROME_BOUNDARY_REVIEW_METERS);
  const coordinateConflicts = unique.filter((record) => record.flags.includes("DUPLICATE_COORDINATE_CONFLICT"));
  const excludedAerodrome = unique.filter((record) => record.excluded_by_aerodrome);
  const missingCoordinates = unique.filter((record) => record.flags.includes("MISSING_COORDINATES"));
  const allDuplicateGroups = unique.filter((record) => record.duplicate_count > 1);

  return {
    generated_at: importedAt,
    source_snapshot_version: raw.osm3s?.timestamp_osm_base ?? raw.timestamp_osm_base ?? null,
    source_url: "https://www.openstreetmap.org/",
    location_id: locationId,
    center: { longitude: DELIVERY_CENTER[0], latitude: DELIVERY_CENTER[1] },
    radius_meters: DELIVERY_RADIUS_METERS,
    boundary_semantics: "Addresses inside or on the aerodrome polygon boundary are excluded.",
    source_objects: raw.elements.length,
    unique_addresses: unique.length,
    inside_3km_before_aerodrome_exclusion: unique.filter((record) => record.in_radius).length,
    auto_approvable: autoApprovable.length,
    manual_review: manualReview.length,
    outside_zone: unique.filter((record) => Number.isFinite(record.distance_meters)
      && record.distance_meters > DELIVERY_RADIUS_METERS).length,
    aerodrome_excluded: excludedAerodrome.length,
    near_aerodrome_boundary: nearAerodrome.length,
    duplicate_groups: allDuplicateGroups.length,
    duplicate_source_objects: allDuplicateGroups.reduce((sum, record) => sum + record.duplicate_count - 1, 0),
    duplicate_conflicts: coordinateConflicts.length,
    suspicious_addresses: suspiciousAddresses.length,
    suspicious_source_objects: suspiciousObjects.length,
    missing_coordinate_source_objects: rawWithoutCoordinates,
    missing_coordinate_unique_addresses: missingCoordinates.length,
    review_distance_band_2800_3000: unique.filter((record) => record.in_radius
      && record.distance_meters_precise >= AUTO_APPROVAL_MAX_DISTANCE_METERS
      && !record.excluded_by_aerodrome).length,
    records: unique,
    auto_approvable_records: autoApprovable,
    manual_review_records: manualReview,
    outside_zone_records: outsideZone,
    near_aerodrome_records: nearAerodrome,
    duplicate_conflict_records: coordinateConflicts,
    duplicate_records: allDuplicateGroups,
    suspicious_records: [...suspiciousObjects, ...suspiciousAddresses]
  };
}

export function compareAddressSnapshots(previous, current) {
  const keyFor = (record) => record.address_key ?? makeAddressKey({
    locationId: record.location_id ?? record.locationId ?? "karimoff-main",
    street: record.street_normalized ?? record.street,
    house: record.house_normalized ?? record.house,
    building: record.building_normalized ?? record.building ?? ""
  });
  const previousByKey = new Map((previous.records ?? previous).map((record) => [keyFor(record), record]));
  const results = [];
  for (const record of current.records) {
    const key = keyFor(record);
    const old = previousByKey.get(key);
    if (!old) results.push({ status: "NEW", ...record });
    else {
      const moved = Number.isFinite(Number(old.latitude)) && Number.isFinite(Number(old.longitude))
        && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
        && haversineMeters([Number(old.longitude), Number(old.latitude)], [record.longitude, record.latitude]) >= 5;
      results.push({ status: moved ? "COORDINATES CHANGED" : "UNCHANGED", ...record });
      previousByKey.delete(key);
    }
  }
  for (const record of previousByKey.values()) results.push({ status: "REMOVED FROM SOURCE", ...record });
  return results.sort((left, right) => left.status.localeCompare(right.status, "en")
    || String(left.street).localeCompare(String(right.street), "ru")
    || String(left.house).localeCompare(String(right.house), "ru"));
}

function ringReviewPoints(ring, count = 8) {
  const lengths = ring.slice(1).map((end, index) => haversineMeters(ring[index], end));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  return Array.from({ length: count }, (_, index) => {
    const target = total * (index + 0.5) / count;
    let traversed = 0;
    let segment = 0;
    while (segment < lengths.length - 1 && traversed + lengths[segment] < target) {
      traversed += lengths[segment];
      segment += 1;
    }
    const fraction = lengths[segment] ? (target - traversed) / lengths[segment] : 0;
    const start = ring[segment];
    const end = ring[segment + 1];
    return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
  });
}

function destinationPoint(center, radius, bearing) {
  const angularDistance = radius / EARTH_RADIUS_METERS;
  const bearingRadians = bearing * Math.PI / 180;
  const latitude1 = center[1] * Math.PI / 180;
  const longitude1 = center[0] * Math.PI / 180;
  const latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(angularDistance)
    + Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearingRadians));
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude1),
    Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
  );
  return [longitude2 * 180 / Math.PI, latitude2 * 180 / Math.PI];
}

export function createReviewGeoJson(snapshot) {
  const boundaryRing = AERODROME_POLYGON.coordinates[0];
  const circle = Array.from({ length: 73 }, (_, index) =>
    destinationPoint(DELIVERY_CENTER, DELIVERY_RADIUS_METERS, index * 5)
  );
  circle[72] = circle[0];
  const features = [
    {
      type: "Feature",
      properties: { role: "store", name: "KARIMOFF, Щёлково, ул. Бахчиванджи, 5Б" },
      geometry: { type: "Point", coordinates: DELIVERY_CENTER }
    },
    {
      type: "Feature",
      properties: { role: "delivery_radius", radius_meters: DELIVERY_RADIUS_METERS },
      geometry: { type: "Polygon", coordinates: [circle] }
    },
    {
      type: "Feature",
      properties: {
        role: "excluded_aerodrome",
        source_relation: "OpenStreetMap relation 3300255",
        boundary_semantics: "inside or on boundary is excluded"
      },
      geometry: AERODROME_POLYGON
    },
    ...snapshot.near_aerodrome_records.map((record) => ({
      type: "Feature",
      properties: {
        role: "house_near_aerodrome_boundary",
        classification: record.classification,
        street: record.street,
        house: record.house,
        building: record.building,
        distance_meters: record.distance_meters_precise,
        boundary_distance_meters: record.boundary_distance_meters,
        source_id: record.source_id,
        source_ids: record.source_ids,
        excluded_by_aerodrome: record.excluded_by_aerodrome
      },
      geometry: { type: "Point", coordinates: [record.longitude, record.latitude] }
    })),
    ...ringReviewPoints(boundaryRing).map((coordinates, index) => ({
      type: "Feature",
      properties: {
        role: "boundary_review_area",
        area_id: `A${index + 1}`,
        instruction: "Visually compare this polygon stretch with current street and runway boundaries."
      },
      geometry: { type: "Point", coordinates }
    }))
  ];
  return {
    type: "FeatureCollection",
    name: "KARIMOFF delivery whitelist manual review",
    properties: {
      source_snapshot_version: snapshot.source_snapshot_version,
      attribution: "© OpenStreetMap contributors",
      source_url: "https://www.openstreetmap.org/copyright",
      license_url: "https://opendatacommons.org/licenses/odbl/1-0/"
    },
    features
  };
}

export function summarizeDiff(records) {
  return records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] ?? 0) + 1;
    return counts;
  }, {});
}
