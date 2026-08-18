import { AnalyticsAccessError, getAnalyticsScope } from "@/lib/analytics/permissions";
import {
  AnalyticsPerformanceQueryError,
  explainRepresentativeAnalyticsQueries
} from "@/lib/analytics/performance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.TEST_ORDER_MODE !== "true") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const scope = await getAnalyticsScope();
    if (scope.role !== "owner" && scope.role !== "admin") {
      return Response.json({ error: "Недостаточно прав." }, { status: 403 });
    }
    const result = await explainRepresentativeAnalyticsQueries();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof AnalyticsAccessError) {
      return Response.json({ error: "Недостаточно прав." }, { status: 403 });
    }
    if (error instanceof AnalyticsPerformanceQueryError) {
      console.error("[analytics.performance.query_failed]", {
        code: error.databaseCode,
        query: error.queryName
      });
    } else {
      console.error("[analytics.performance.failed]", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
    }
    return Response.json({ error: "Не удалось выполнить диагностику." }, { status: 500 });
  }
}
