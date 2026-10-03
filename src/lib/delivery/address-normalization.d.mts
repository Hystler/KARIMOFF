export function normalizeStreet(value: unknown): string;
export function normalizeHouse(value: unknown): string;
export function normalizeBuilding(value: unknown): string;
export function makeAddressKey(input: {
  locationId: string;
  street: string;
  house: string;
  building?: string;
}): string;
