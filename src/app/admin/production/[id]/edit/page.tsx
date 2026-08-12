import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProductionRecipeForm } from "@/components/admin/ProductionRecipeForm";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getProductionRecipeById } from "@/lib/production";
import { saveProductionRecipeAction } from "../../actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function EditProductionRecipePage({ params, searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role === "cook") redirect("/admin/login");
  const { id } = await params;
  const currentSearchParams = searchParams ? await searchParams : {};
  const workspace = await getProductionRecipeById(id);
  if (!workspace.error && !workspace.recipe) notFound();

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <Link href="/admin/production" className="text-sm font-bold text-karimoff-muted transition hover:text-karimoff-orange">Производство</Link>
          <h1>{workspace.recipe?.name ?? "Производственная карта"}</h1>
          <p>Изменения пересчитают плановую себестоимость. Склад меняется только при проведении фактического выпуска.</p>
        </div>
      </header>
      {currentSearchParams.error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(currentSearchParams.error)}</div> : null}
      {workspace.error ? <div className="admin-alert admin-alert-error">{workspace.error}</div> : null}
      {workspace.recipe ? (
        <ProductionRecipeForm
          action={saveProductionRecipeAction}
          ingredients={workspace.ingredients.filter((ingredient) => ingredient.is_active || ingredient.id === workspace.recipe?.output_ingredient_id)}
          monthlyOverhead={workspace.monthlyOverhead}
          recipe={workspace.recipe}
          totalPlannedMinutes={workspace.totalPlannedMinutes}
        />
      ) : null}
    </main>
  );
}
