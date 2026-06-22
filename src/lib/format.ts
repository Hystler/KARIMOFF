export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits
  }).format(value);
}

export function formatRub(value: number | null | undefined, maximumFractionDigits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "не задан";
  }

  return `${formatNumber(value, maximumFractionDigits)} ₽`;
}

export function formatPercent(value: number | null | undefined, maximumFractionDigits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return `${formatNumber(value, maximumFractionDigits)}%`;
}

