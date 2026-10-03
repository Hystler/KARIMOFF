import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const AERODROME_POLYGON = require("./aerodrome-polygon.json");
export const DELIVERY_CENTER = Object.freeze([38.055708, 55.909221]);
export const DELIVERY_RADIUS_METERS = 3000;
const EARTH_RADIUS_METERS = 6_371_008.8;

export function haversineMeters(from, to) {
  const radians = Math.PI / 180;
  const lat1 = from[1] * radians;
  const lat2 = to[1] * radians;
  const dLat = (to[1] - from[1]) * radians;
  const dLon = (to[0] - from[0]) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, a)));
}

function pointOnSegment(point, start, end) {
  const scale = Math.PI / 180 * EARTH_RADIUS_METERS;
  const cosLatitude = Math.cos(point[1] * Math.PI / 180);
  const project = ([longitude, latitude]) => [
    longitude * scale * cosLatitude,
    latitude * scale
  ];
  const p = project(point);
  const a = project(start);
  const b = project(end);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function isInsideRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const start = ring[previous];
    const end = ring[current];
    if (pointOnSegment(point, start, end) <= 0.01) return true;
    const crosses = (end[1] > point[1]) !== (start[1] > point[1])
      && point[0] < ((start[0] - end[0]) * (point[1] - end[1])) / (start[1] - end[1]) + end[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isInsideAerodrome(point) {
  const [outer, ...holes] = AERODROME_POLYGON.coordinates;
  return isInsideRing(point, outer) && !holes.some((hole) => isInsideRing(point, hole));
}

export function distanceToAerodromeBoundaryMeters(point) {
  const [outer, ...holes] = AERODROME_POLYGON.coordinates;
  const rings = [outer, ...holes];
  return Math.min(...rings.flatMap((ring) => ring.slice(1).map((end, index) =>
    pointOnSegment(point, ring[index], end)
  )));
}

export function assessDeliveryPoint(point) {
  const distanceMeters = haversineMeters(DELIVERY_CENTER, point);
  const boundaryDistanceMeters = distanceToAerodromeBoundaryMeters(point);
  const excludedByAerodrome = isInsideAerodrome(point);
  return {
    distanceMeters,
    boundaryDistanceMeters,
    excludedByAerodrome,
    inRadius: distanceMeters <= DELIVERY_RADIUS_METERS + 1e-6,
    available: distanceMeters <= DELIVERY_RADIUS_METERS + 1e-6 && !excludedByAerodrome
  };
}

export function deliveryAddressText(address) {
  const house = [address.house, address.building ? `корп. ${address.building}` : ""]
    .filter(Boolean)
    .join(", ");
  return `${address.street}, ${house}`;
}
