import { Clock3, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { AnalyticsFilterBar } from "@/components/admin/analytics/AnalyticsFilterBar";
import { AnalyticsOverview } from "@/components/admin/analytics/AnalyticsOverview";
import { AnalyticsRefreshButton } from "@/components/admin/analytics/AnalyticsRefreshButton";
import { AnalyticsSubnav } from "@/components/admin/analytics/AnalyticsSubnav";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAnalyticsDashboard } from "@/lib/analytics/dashboard";
import { parseAnalyticsFilters } from "@/lib/analytics/filters";
import { getAnalyticsScope } from "@/lib/analytics/permissions";
import { getAnalyticsRange } from "@/lib/analytics/periods";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/admin/kitchen");

  const filters = parseAnalyticsFilters(searchParams ? await searchParams : {});
  const range = getAnalyticsRange({
    period: filters.period,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  });
  const scope = await getAnalyticsScope();
  const dashboard = await getAnalyticsDashboard({ filters, range, scope });
  const updatedLabel = dashboard.updatedAt
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow"
      }).format(new Date(dashboard.updatedAt))
    : "данных пока нет";

  return (
    <main className="admin-content admin-content-wide analytics-page">
      <header className="admin-heading analytics-heading">
        <div>
          <p className="admin-eyebrow">Единая картина бизнеса</p>
          <h1>Аналитика продаж</h1>
          <p>Касса и интернет-заказы в одной системе метрик без двойного складского списания.</p>
        </div>
        <div className="analytics-heading-actions">
          <span><Clock3 size={16} />Данные обновлены: {updatedLabel}</span>
          <AnalyticsRefreshButton />
        </div>
      </header>

      <AnalyticsSubnav active="overview" />
      <AnalyticsFilterBar filters={filters} options={dashboard.options} />

      {scope.role === "manager" && scope.locationIds?.length === 0 ? (
        <div className="admin-alert admin-alert-warning mt-5">
          Управляющему пока не назначена ни одна точка. Обратитесь к владельцу.
        </div>
      ) : null}

      <div className="analytics-scope-note">
        <ShieldCheck size={16} />
        <span>{scope.role === "manager" ? "Данные ограничены разрешёнными точками" : "Доступна аналитика всей сети"}</span>
      </div>

      <AnalyticsOverview dashboard={dashboard} />
    </main>
  );
}
