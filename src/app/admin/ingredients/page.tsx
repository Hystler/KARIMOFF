import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIngredients } from "@/lib/ingredients";
import { formatInventoryQuantity, getInventoryByIngredientIds } from "@/lib/inventory";
import { createInventoryItemAction } from "../inventory/actions";
import { logoutAction } from "../login/actions";
import { archiveIngredientAction, toggleIngredientActiveAction } from "./actions";

type AdminIngredientsPageProps = {
  searchParams?: Promise<{
    archived?: string;
    error?: string;
    restored?: string;
    saved?: string;
    view?: string;
  }>;
};

export const dynamic = "force-dynamic";

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value)} ₽`;
}

function getMessage(params: Awaited<NonNullable<AdminIngredientsPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Ингредиент сохранён." };
  }

  if (params.archived) {
    return { tone: "success", text: "Ингредиент перемещён в архив. История заказов и расчётов сохранена." };
  }

  if (params.restored) {
    return { tone: "success", text: "Ингредиент возвращён в работу." };
  }

  if (params.error === "database") {
    return { tone: "error", text: "База данных не подключена. Заполните переменные окружения." };
  }

  if (params.error === "archive" || params.error === "save") {
    return { tone: "error", text: "Не удалось изменить статус ингредиента. Попробуйте ещё раз." };
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
  const showArchived = params.view === "archived";
  const visibleIngredients = ingredients.filter((ingredient) => ingredient.is_active !== showArchived);
  const archivedCount = ingredients.filter((ingredient) => !ingredient.is_active).length;
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
            <Link href={showArchived ? "/admin/ingredients" : "/admin/ingredients?view=archived"} className="rounded-full border border-karimoff-black/15 bg-white px-5 py-3 text-center text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              {showArchived ? "Активные ингредиенты" : `Архив${archivedCount ? ` · ${archivedCount}` : ""}`}
            </Link>
            <Link href="/admin/ingredients/prices" className="rounded-full border border-karimoff-black/15 bg-white px-5 py-3 text-center text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              Цены и упаковки
            </Link>
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
            <div className="p-8 text-karimoff-muted">База данных не подключена. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : visibleIngredients.length === 0 ? (
            <div className="p-8 text-karimoff-muted">
              {showArchived ? "В архиве пока нет ингредиентов." : "Активных ингредиентов пока нет."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table min-w-[1320px]">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Название</th>
                    <th className="px-4 py-4 font-bold">Категория</th>
                    <th className="px-4 py-4 font-bold">Ед.</th>
                    <th className="px-4 py-4 font-bold">Остаток</th>
                    <th className="px-4 py-4 font-bold">Мин.</th>
                    <th className="px-4 py-4 font-bold">Упаковка</th>
                    <th className="px-4 py-4 font-bold">Себестоимость</th>
                    <th className="px-4 py-4 font-bold">Отходы</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIngredients.map((ingredient) => {
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
                          <span className={`font-bold ${ingredient.waste_percent > 0 ? "text-amber-700" : "text-karimoff-muted"}`}>
                            {ingredient.waste_percent}%
                          </span>
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
                            {ingredient.is_active ? (
                              <form action={archiveIngredientAction}>
                                <input type="hidden" name="id" value={ingredient.id} />
                                <ConfirmSubmitButton
                                  message={`Переместить ингредиент «${ingredient.name}» в архив? История заказов сохранится.`}
                                  className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                                >
                                  В архив
                                </ConfirmSubmitButton>
                              </form>
                            ) : (
                              <form action={toggleIngredientActiveAction}>
                                <input type="hidden" name="id" value={ingredient.id} />
                                <input type="hidden" name="next_active" value="true" />
                                <input type="hidden" name="return_to" value="/admin/ingredients?view=archived" />
                                <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-[#D95405]">
                                  Вернуть в работу
                                </button>
                              </form>
                            )}
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
