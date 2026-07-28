import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/admin/KitchenBoard";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getAdminOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; warning?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");

  const params = await searchParams;
  const { orders, error } = await getAdminOrders();
  const queue = orders.filter((order) => order.status === "new" || order.status === "in_progress");

  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Кухня · обновление каждые 15 секунд</p>
          <h1>Экран заказов</h1>
          <p>{staff.name}, здесь только то, что нужно приготовить прямо сейчас.</p>
        </div>
        <div className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm font-bold">
          В очереди: <span className="text-karimoff-orange">{queue.length}</span>
        </div>
      </header>

      {params.error || error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(params.error || error || "")}</div> : null}
      {params.saved ? <div className="admin-alert admin-alert-success">Статус заказа обновлён.</div> : null}
      {params.warning ? <div className="admin-alert admin-alert-warning">{decodeURIComponent(params.warning)}</div> : null}

      <KitchenBoard orders={queue} />
    </main>
  );
}
