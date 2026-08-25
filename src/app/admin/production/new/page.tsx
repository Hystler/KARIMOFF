import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductionRecipeForm } from "@/components/admin/ProductionRecipeForm";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getProductionWorkspace } from "@/lib/production";
import { saveProductionRecipeAction } from "../actions";

type PageProps = { searchParams?: Promise<{ error?: string }> };

export const dynamic = "force-dynamic";

export default async function NewProductionRecipePage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin/login");
  const params = searchParams ? await searchParams : {};
  const workspace = await getProductionWorkspace();

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <Link href="/admin/production" className="text-sm font-bold text-karimoff-muted transition hover:text-karimoff-orange">Производство</Link>
          <h1>Новая производственная карта</h1>
          <p>Опишите одну понятную партию: сырьё, выход, время, прямые расходы и цену для франчайзи.</p>
        </div>
      </header>
      {params.error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(params.error)}</div> : null}
      {workspace.error ? <div className="admin-alert admin-alert-error">{workspace.error}</div> : null}
      {!workspace.error && workspace.ingredients.length === 0 ? (
        <div className="admin-empty">Сначала создайте сырьё и выходной полуфабрикат в разделе <Link href="/admin/ingredients" className="font-black text-karimoff-orange">«Ингредиенты»</Link>.</div>
      ) : (
        <ProductionRecipeForm
          action={saveProductionRecipeAction}
          ingredients={workspace.ingredients.filter((ingredient) => ingredient.is_active)}
          monthlyOverhead={workspace.monthlyOverhead}
          totalPlannedMinutes={workspace.totalPlannedMinutes}
        />
      )}
    </main>
  );
}
