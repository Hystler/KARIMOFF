import type { EconomicsValues } from "./economics-values";

export type EconomicsFieldErrors = Partial<Record<keyof EconomicsValues, string>>;

export type EconomicsSaveState = {
  fieldErrors?: EconomicsFieldErrors;
  message: string | null;
  status: "idle" | "success" | "error";
  values?: EconomicsValues;
};

export const initialEconomicsSaveState: EconomicsSaveState = {
  message: null,
  status: "idle"
};

const groupedNumberFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  useGrouping: true
});

export function normalizeEconomicsNumberText(value: string) {
  return value.trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
}

export function parseEconomicsNumber(value: string) {
  const normalized = normalizeEconomicsNumberText(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatEconomicsNumber(value: number) {
  return groupedNumberFormatter.format(value);
}

export function formatEconomicsDraft(value: string) {
  const parsed = parseEconomicsNumber(value);
  return parsed === null ? value : formatEconomicsNumber(parsed);
}

export function economicsValuesToDrafts(values: EconomicsValues) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value)])
  ) as Record<keyof EconomicsValues, string>;
}
