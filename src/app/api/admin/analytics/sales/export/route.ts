import { getChannelLabel } from "@/lib/analytics/channels";
import { parseAnalyticsFilters } from "@/lib/analytics/filters";
import { getPaymentMethodLabel, getSaleStatusLabel } from "@/lib/analytics/metrics";
import { AnalyticsAccessError, getAnalyticsScope } from "@/lib/analytics/permissions";
import { getAnalyticsRange } from "@/lib/analytics/periods";
import { getAnalyticsSalesExportBatch, type SalesExportCursor } from "@/lib/analytics/sales";
import type { AnalyticsSaleRow } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

function money(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function rowToCsv(row: AnalyticsSaleRow) {
  return [
    new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Europe/Moscow"
    }).format(new Date(row.analyticsAt)),
    row.number,
    getChannelLabel(row.channel),
    row.location,
    row.terminal ?? "",
    row.employee ?? row.customer ?? "",
    row.itemsCount,
    money(row.grossAmount),
    money(row.discountAmount),
    money(row.refundAmount),
    money(row.netRevenue),
    getPaymentMethodLabel(row.paymentMethod),
    row.paymentProvider === "yookassa" ? "YooKassa" : row.paymentProvider === "evotor" ? "Evotor" : row.paymentProvider,
    getSaleStatusLabel(row.status),
    row.included ? "Да" : "Нет"
  ].map(safeCell).join(";");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseAnalyticsFilters(url.searchParams);
    const range = getAnalyticsRange({
      period: filters.period,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo
    });
    const scope = await getAnalyticsScope();
    const encoder = new TextEncoder();
    let cursor: SalesExportCursor = null;
    let completed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`\uFEFF${[
          "Дата и время", "Номер", "Канал", "Точка", "Касса", "Сотрудник / клиент",
          "Позиции", "До скидки", "Скидка", "Возврат", "Итого", "Оплата", "Провайдер", "Статус", "В выручке"
        ].map(safeCell).join(";")}\n`));
      },
      async pull(controller) {
        if (completed || request.signal.aborted) {
          controller.close();
          return;
        }
        try {
          const rows = await getAnalyticsSalesExportBatch({ filters, range, scope, cursor, limit: 500 });
          if (!rows.length) {
            completed = true;
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`${rows.map(rowToCsv).join("\n")}\n`));
          const last = rows.at(-1);
          cursor = last ? { analyticsAt: last.analyticsAt, saleId: last.saleId } : null;
          if (rows.length < 500) completed = true;
        } catch (error) {
          controller.error(error);
        }
      }
    });

    const stamp = range.fromDateKey === range.toDateKeyExclusive
      ? range.fromDateKey
      : `${range.fromDateKey}_${range.toDateKeyExclusive}`;
    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="karimoff-sales-${stamp}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof AnalyticsAccessError) {
      return Response.json({ error: "Недостаточно прав." }, { status: 403 });
    }
    return Response.json({ error: "Не удалось подготовить экспорт." }, { status: 500 });
  }
}
