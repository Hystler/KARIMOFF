import type { MetricDelta } from "./types";

export function calculateMetricDelta(current: number, previous: number): MetricDelta {
  const absolute = current - previous;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { absolute: 0, percent: null, direction: "unavailable" };
  }
  if (previous === 0) {
    if (current === 0) return { absolute: 0, percent: null, direction: "flat" };
    return { absolute, percent: null, direction: "new" };
  }
  const percent = (absolute / Math.abs(previous)) * 100;
  return {
    absolute,
    percent,
    direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat"
  };
}

export function safeAverage(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

export function normalizePaymentMethod(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["cash", "cash_on_delivery"].includes(normalized)) return "cash";
  if (["electron", "card", "bank_card"].includes(normalized)) return "bank_card";
  if (["sbp", "fps", "qr"].includes(normalized)) return "sbp";
  if (["online_acquiring", "yookassa", "acquiring"].includes(normalized)) return "online_acquiring";
  if (normalized === "mixed") return "mixed";
  return "unknown";
}

export const paymentMethodLabels: Record<string, string> = {
  cash: "Наличные",
  bank_card: "Банковская карта",
  online_acquiring: "Онлайн-эквайринг",
  sbp: "СБП",
  mixed: "Смешанная оплата",
  unknown: "Не определено"
};

export function getPaymentMethodLabel(value: string) {
  return paymentMethodLabels[normalizePaymentMethod(value)] ?? "Другое";
}

export const saleStatusLabels: Record<string, string> = {
  completed: "Завершено",
  refunded: "Возврат",
  corrected: "Коррекция",
  new: "Новый",
  in_progress: "В работе",
  cancelled: "Отменён"
};

export function getSaleStatusLabel(value: string) {
  return saleStatusLabels[value] ?? "Не определён";
}
