import { redirect } from "next/navigation";
import { AnalyticsSubnav } from "@/components/admin/analytics/AnalyticsSubnav";
import { PurchasePlanning } from "@/components/admin/analytics/PurchasePlanning";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getPurchasePlanning, parsePlanningOptions } from "@/lib/analytics/planning";

export const dynamic = "force-dynamic";

export default async function PlanningPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!["owner", "admin"].includes(staff.role)) redirect("/admin");
  let plan: Awaited<ReturnType<typeof getPurchasePlanning>> | null = null;
  try {
    plan = await getPurchasePlanning(parsePlanningOptions(searchParams ? await searchParams : {}));
  } catch {
    console.warn("analytics.planning.unavailable");
  }
  return <main className="admin-content admin-content-wide analytics-page">
    <header className="admin-heading"><div><p className="admin-eyebrow">Продажи и склад</p><h1>План закупок</h1></div></header>
    <AnalyticsSubnav active="planning" />
    {plan ? <PurchasePlanning plan={plan} /> : <p role="alert" className="my-6 rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">Не удалось получить данные для расчёта. Обновите страницу позже.</p>}
  </main>;
}
