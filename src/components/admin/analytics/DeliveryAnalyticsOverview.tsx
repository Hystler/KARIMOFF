import { Clock3, PackageCheck, Truck } from "lucide-react";
import type { DeliveryAnalyticsSummary } from "@/lib/analytics/types";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";

function duration(seconds: number | null) {
  if (seconds === null) return "Недостаточно данных";
  if (seconds < 60) return `${formatNumber(seconds, 0)} сек`;
  if (seconds < 3600) return `${formatNumber(seconds / 60, 1)} мин`;
  return `${formatNumber(seconds / 3600, 1)} ч`;
}

export function DeliveryAnalyticsOverview({ summary }: { summary: DeliveryAnalyticsSummary }) {
  const metrics = [
    ["Доставлено заказов", formatNumber(summary.deliveredOrders)],
    ["Выручка доставки", formatRub(summary.revenue)],
    ["Средний чек доставки", summary.averageCheck === null ? "Недостаточно данных" : formatRub(summary.averageCheck)],
    ["Выручка товаров", formatRub(summary.merchandiseRevenue)],
    ["Выручка доставки как услуги", formatRub(summary.deliveryFeeRevenue)],
    ["Платных доставок", formatNumber(summary.paidDeliveries)],
    ["Бесплатных доставок", `${formatNumber(summary.freeDeliveries)}${summary.freeDeliveryShare === null ? "" : ` · ${formatPercent(summary.freeDeliveryShare * 100)}`}`],
    ["Возвраты", formatRub(summary.refundAmount)],
    ["Отменено заказов", formatNumber(summary.cancelledOrders)],
    ["Оплата → доставлено", duration(summary.averagePaidToDeliveredSeconds)],
    ["Готов → доставлено", duration(summary.averageReadyToDeliveredSeconds)],
    ["Завершённых доставок в день", summary.ordersPerDay === null ? "Недостаточно данных" : formatNumber(summary.ordersPerDay, 1)]
  ] as const;

  return (
    <section className="analytics-panel analytics-delivery-panel" aria-labelledby="delivery-analytics-title">
      <header className="analytics-panel-heading compact">
        <div><p className="admin-eyebrow">YooKassa · один заказ = одна продажа</p><h2 id="delivery-analytics-title">Доставка</h2></div>
        <span className="inline-flex items-center gap-2 text-xs font-bold text-karimoff-muted"><Truck size={16} />{formatNumber(summary.deliveredOrders)} завершено</span>
      </header>
      <div className="analytics-delivery-metrics">
        {metrics.map(([label, value], index) => (
          <div key={label}>
            {index === 9 || index === 10 ? <Clock3 size={15} aria-hidden="true" /> : index === 0 ? <PackageCheck size={15} aria-hidden="true" /> : null}
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
