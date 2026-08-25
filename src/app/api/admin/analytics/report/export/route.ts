import { parseAnalyticsFilters } from "@/lib/analytics/filters";
import { AnalyticsAccessError, getAnalyticsScope } from "@/lib/analytics/permissions";
import { getAnalyticsRange } from "@/lib/analytics/periods";
import { getAnalyticsReportRows } from "@/lib/analytics/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const report = url.searchParams.get("report") === "categories" ? "categories" : "products";
    const filters = parseAnalyticsFilters(url.searchParams);
    const range = getAnalyticsRange({ period: filters.period, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    const scope = await getAnalyticsScope();
    const rows = await getAnalyticsReportRows({ report, filters, range, scope });
    const header = ["ID", "Название", "Категория", "Выручка", "Количество", "Чеков", "Средняя цена", "Доля, %", "Mapping"];
    const body = rows.map((row) => [
      row.key, row.name, row.category, row.revenue.toFixed(2), row.quantity.toFixed(3), row.receipts,
      row.averageItemPrice.toFixed(2), row.share.toFixed(2), row.mappingStatus
    ].map(safeCell).join(";"));
    return new Response(`\uFEFF${header.map(safeCell).join(";")}\n${body.join("\n")}\n`, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="karimoff-${report}-${range.fromDateKey}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof AnalyticsAccessError) return Response.json({ error: "Недостаточно прав." }, { status: 403 });
    return Response.json({ error: "Не удалось подготовить экспорт." }, { status: 500 });
  }
}
