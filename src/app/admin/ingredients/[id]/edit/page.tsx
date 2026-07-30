import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IngredientForm } from "@/components/admin/IngredientForm";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIngredientById } from "@/lib/ingredients";
import { formatInventoryQuantity, getInventoryByIngredientIds } from "@/lib/inventory";
import { createInventoryItemAction, updateInventoryCardAction } from "../../../inventory/actions";
import { logoutAction } from "../../../login/actions";
import { updateIngredientAction } from "../../actions";

type EditIngredientPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function EditIngredientPage({ params, searchParams }: EditIngredientPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const { id } = await params;
  const currentSearchParams = searchParams ? await searchParams : {};
  const { ingredient, notConfigured, error } = await getAdminIngredientById(id);
  const inventoryResult = ingredient ? await getInventoryByIngredientIds([ingredient.id]) : null;
  const inventoryItem = ingredient ? inventoryResult?.itemsByIngredient.get(ingredient.id) ?? null : null;

  if (!notConfigured && !error && !ingredient) {
    notFound();
  }

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin/ingredients" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Ингредиенты
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Редактировать ингредиент</h1>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              Выйти
            </button>
          </form>
        </header>
        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">База данных не подключена.</div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">{error}</div>
        ) : (
          <>
            {currentSearchParams.error ? <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{decodeURIComponent(currentSearchParams.error)}</div> : null}
            <IngredientForm action={updateIngredientAction} ingredient={ingredient} submitLabel="Сохранить ингредиент" />
            {ingredient ? (
              <section className="mt-8 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
                <div>
                  <p className="text-sm font-semibold text-karimoff-orange">Складская карточка</p>
                  <h2 className="mt-2 text-2xl font-black">Остатки ингредиента</h2>
                  <p className="mt-2 text-sm leading-6 text-karimoff-muted">
                    Здесь задаётся минимальный остаток, локация и стартовое количество. Дальше приход, списание и корректировка ведутся в разделе “Склад”.
                  </p>
                </div>
                {inventoryResult?.error ? (
                  <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
                    {inventoryResult.error}
                  </div>
                ) : (
                  <form action={inventoryItem ? updateInventoryCardAction : createInventoryItemAction} className="mt-5 grid gap-4 md:grid-cols-2">
                    <input type="hidden" name="ingredient_id" value={ingredient.id} />
                    <input type="hidden" name="return_to" value={`/admin/ingredients/${ingredient.id}/edit`} />
                    <label className="grid gap-2 text-sm font-semibold">
                      Текущий остаток
                      <input
                        name="current_quantity"
                        type="number"
                        min="0"
                        step="0.001"
                        defaultValue={inventoryItem?.current_quantity ?? 0}
                        className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange"
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-semibold">
                      Минимальный остаток
                      <input
                        name="min_quantity"
                        type="number"
                        min="0"
                        step="0.001"
                        defaultValue={inventoryItem?.min_quantity ?? 0}
                        className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange"
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-semibold md:col-span-2">
                      Локация
                      <input
                        name="location"
                        defaultValue={inventoryItem?.location ?? ""}
                        placeholder="Например: основной склад / холодильник / кухня"
                        className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange"
                      />
                    </label>
                    <div className="md:col-span-2">
                      <p className="mb-3 text-sm font-semibold text-karimoff-muted">
                        Сейчас: {inventoryItem ? formatInventoryQuantity(inventoryItem.current_quantity, inventoryItem.unit) : "карточка не создана"}
                      </p>
                      <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)] transition hover:bg-[#D95405]">
                        {inventoryItem ? "Сохранить складскую карточку" : "Создать складскую карточку"}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
