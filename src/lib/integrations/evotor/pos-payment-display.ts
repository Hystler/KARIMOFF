export function formatPosPaymentDisplayValue(
  value: string | number | Date | null | undefined
): string | number {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "—" : value.toISOString();
  }
  return value ?? "—";
}
