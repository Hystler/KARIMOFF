export type Coordinate = [number, number];
export const AERODROME_POLYGON: { type: "Polygon"; coordinates: Coordinate[][] };
export const DELIVERY_CENTER: Coordinate;
export const DELIVERY_RADIUS_METERS: 3000;
export function haversineMeters(from: Coordinate, to: Coordinate): number;
export function isInsideAerodrome(point: Coordinate): boolean;
export function distanceToAerodromeBoundaryMeters(point: Coordinate): number;
export function assessDeliveryPoint(point: Coordinate): {
  distanceMeters: number;
  boundaryDistanceMeters: number;
  excludedByAerodrome: boolean;
  inRadius: boolean;
  available: boolean;
};
export function deliveryAddressText(address: {
  street: string;
  house: string;
  building?: string | null;
}): string;
