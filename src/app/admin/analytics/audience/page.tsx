import { ShieldCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AnalyticsFilterBar } from "@/components/admin/analytics/AnalyticsFilterBar";
import { AnalyticsSubnav } from "@/components/admin/analytics/AnalyticsSubnav";
import { AudienceAnalytics } from "@/components/admin/analytics/AudienceAnalytics";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAudienceDashboard } from "@/lib/analytics/audience";
import { getAnalyticsFilterOptions } from "@/lib/analytics/dashboard";
import { parseAnalyticsFilters } from "@/lib/analytics/filters";
import { getAnalyticsScope } from "@/lib/analytics/permissions";
import { getAnalyticsRange } from "@/lib/analytics/periods";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export default async function AudiencePage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (staff.role === "cook") redirect("/kitchen");
  if (staff.role === "cashier") redirect("/pos");

  const filters = parseAnalyticsFilters(searchParams ? await searchParams : {});
  const range = getAnalyticsRange({ period: filters.period, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  const scope = await getAnalyticsScope();
  const [dashboard, options] = await Promise.all([
    getAudienceDashboard({ filters, range, scope }),
    getAnalyticsFilterOptions(scope)
  ]);

  return (
    <main className="admin-content admin-content-wide analytics-page">
      <header className="admin-heading analytics-heading">
        <div>
          <p className="admin-eyebrow">CRM-аналитика</p>
          <h1>Целевая аудитория</h1>
          <p>Кто возвращается, что выбирает и с кем KARIMOFF уже может поддерживать связь.</p>
        </div>
        <div className="analytics-heading-actions"><span><UsersRound size={16} />Период активности: {dashboard.rangeLabel}</span></div>
      </header>

      <AnalyticsSubnav active="audience" />
      <AnalyticsFilterBar filters={filters} options={options} />

      <div className="analytics-scope-note">
        <ShieldCheck size={16} />
        <span>{scope.role === "manager" ? "Аудитория ограничена разрешёнными точками" : "Доступна аудитория всей сети"}</span>
      </div>

      <AudienceAnalytics dashboard={dashboard} />
    </main>
  );
}
