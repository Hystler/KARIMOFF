export type Coordinate = [longitude: number, latitude: number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: Coordinate[][];
} | {
  type: "MultiPolygon";
  coordinates: Coordinate[][][];
};

const EARTH_RADIUS_METERS = 6_371_008.8;

export function distanceMeters(from: Coordinate, to: Coordinate) {
  const radians = Math.PI / 180;
  const latitudeDelta = (to[1] - from[1]) * radians;
  const longitudeDelta = (to[0] - from[0]) * radians;
  const fromLatitude = from[1] * radians;
  const toLatitude = to[1] * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function liesOnSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const cross = (point[1] - start[1]) * (end[0] - start[0])
    - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (point[0] - start[0]) * (end[0] - start[0])
    + (point[1] - start[1]) * (end[1] - start[1]);
  const lengthSquared = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  return dot >= -1e-12 && dot <= lengthSquared + 1e-12;
}

function isInsideRing(point: Coordinate, ring: Coordinate[]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const start = ring[previous];
    const end = ring[current];
    if (liesOnSegment(point, start, end)) return true;
    const crosses = (end[1] > point[1]) !== (start[1] > point[1])
      && point[0] < ((start[0] - end[0]) * (point[1] - end[1])) / (start[1] - end[1]) + end[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isInsidePolygon(point: Coordinate, geometry: PolygonGeometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) =>
    isInsideRing(point, outer) && !holes.some((hole) => isInsideRing(point, hole))
  );
}

export function assessDeliveryZone(params: {
  address: Coordinate;
  center: Coordinate;
  radiusMeters: number;
  excludedAreas: Array<{ geometry: PolygonGeometry }>;
}) {
  if (!isValidCoordinate(params.address) || !isValidCoordinate(params.center)
    || !Number.isFinite(params.radiusMeters) || params.radiusMeters <= 0) {
    throw new RangeError("Invalid delivery-zone coordinates or radius.");
  }
  const distance = distanceMeters(params.center, params.address);
  const excluded = params.excludedAreas.some((area) => isInsidePolygon(params.address, area.geometry));
  const withinRadius = distance <= params.radiusMeters + 1e-6;

  return {
    available: withinRadius && !excluded,
    distanceMeters: Math.round(distance),
    excluded,
    withinRadius
  };
}

export function isValidCoordinate(point: Coordinate) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1])
    && point[0] >= -180 && point[0] <= 180
    && point[1] >= -90 && point[1] <= 90;
}
