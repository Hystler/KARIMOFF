import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIngredients } from "@/lib/ingredients";
import { formatInventoryQuantity, getInventoryByIngredientIds } from "@/lib/inventory";
import { createInventoryItemAction } from "../inventory/actions";
import { logoutAction } from "../login/actions";
import { deleteIngredientAction, toggleIngredientActiveAction } from "./actions";

type AdminIngredientsPageProps = {
  searchParams?: Promise<{ deleted?: string; error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value)} ₽`;
}

function getMessage(params: Awaited<NonNullable<AdminIngredientsPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Ингредиент сохранён." };
  }

  if (params.deleted) {
    return { tone: "success", text: "Ингредиент удалён." };
  }

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
  }

  return null;
}

export default async function AdminIngredientsPage({ searchParams }: AdminIngredientsPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { ingredients, notConfigured, error } = await getAdminIngredients();
  const inventoryResult = error ? null : await getInventoryByIngredientIds(ingredients.map((ingredient) => ingredient.id));

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Ингредиенты</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/ingredients/new" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405]">
              Создать ингредиент
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
                Выйти
              </button>
            </form>
          </div>
        </header>

        {message ? (
          <div className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${message.tone === "success" ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange" : "border-red-200 bg-red-50 text-red-700"}`}>
            {message.text}
          </div>
        ) : null}

        {inventoryResult?.error ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
            Склад временно недоступен: {inventoryResult.error}
          </div>
        ) : null}

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : ingredients.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Ингредиентов пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table min-w-[1220px]">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Название</th>
                    <th className="px-4 py-4 font-bold">Категория</th>
                    <th className="px-4 py-4 font-bold">Ед.</th>
                    <th className="px-4 py-4 font-bold">Остаток</th>
                    <th className="px-4 py-4 font-bold">Мин.</th>
                    <th className="px-4 py-4 font-bold">Упаковка</th>
                    <th className="px-4 py-4 font-bold">Себестоимость</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((ingredient) => {
                    const inventoryItem = inventoryResult?.itemsByIngredient.get(ingredient.id) ?? null;
                    const isLow = inventoryItem && inventoryItem.min_quantity > 0 && inventoryItem.current_quantity <= inventoryItem.min_quantity;

                    return (
                      <tr key={ingredient.id} className="border-b border-karimoff-line last:border-b-0">
                        <td className="px-4 py-4">
                          <p className="font-semibold">{ingredient.name}</p>
                          <p className="mt-1 text-xs text-karimoff-muted">#{ingredient.sort_order}</p>
                          {isLow ? <p className="mt-2 text-xs font-bold text-amber-700">Низкий остаток</p> : null}
                        </td>
                        <td className="px-4 py-4">{ingredient.category ?? "—"}</td>
                        <td className="px-4 py-4">{ingredient.unit}</td>
                        <td className="px-4 py-4 font-bold">
                          {inventoryItem ? formatInventoryQuantity(inventoryItem.current_quantity, inventoryItem.unit) : "Карточка не создана"}
                        </td>
                        <td className="px-4 py-4 text-karimoff-muted">
                          {inventoryItem ? formatInventoryQuantity(inventoryItem.min_quantity, inventoryItem.unit) : "—"}
                        </td>
                        <td className="px-4 py-4 text-karimoff-muted">
                          {ingredient.package_size && ingredient.package_price
                            ? `${ingredient.package_size} ${ingredient.unit} / ${formatMoney(ingredient.package_price)}`
                            : "—"}
                        </td>
                        <td className="px-4 py-4 font-black text-karimoff-orange">
                          {formatMoney(ingredient.cost_per_unit)} / {ingredient.unit}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${ingredient.is_active ? "bg-karimoff-orange/10 text-karimoff-orange" : "bg-karimoff-black/5 text-karimoff-muted"}`}>
                            {ingredient.is_active ? "Активен" : "Скрыт"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/admin/ingredients/${ingredient.id}/edit`} className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                              Редактировать
                            </Link>
                            {!inventoryItem && !inventoryResult?.error ? (
                              <form action={createInventoryItemAction}>
                                <input type="hidden" name="ingredient_id" value={ingredient.id} />
                                <input type="hidden" name="return_to" value="/admin/ingredients" />
                                <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-[#D95405]">
                                  Создать складскую карточку
                                </button>
                              </form>
                            ) : null}
                            <form action={toggleIngredientActiveAction}>
                              <input type="hidden" name="id" value={ingredient.id} />
                              <input type="hidden" name="next_active" value={String(!ingredient.is_active)} />
                              <button type="submit" className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                                {ingredient.is_active ? "Скрыть" : "Показать"}
                              </button>
                            </form>
                            <form action={deleteIngredientAction}>
                              <input type="hidden" name="id" value={ingredient.id} />
                              <ConfirmSubmitButton message={`Удалить ингредиент «${ingredient.name}»?`} className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50">
                                Удалить
                              </ConfirmSubmitButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
