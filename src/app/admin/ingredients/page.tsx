import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, ArchiveRestore, LogOut, PackagePlus, Pencil, Plus } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { IngredientNutritionSource, IngredientNutritionValues } from "@/components/admin/IngredientNutritionDisplay";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIngredients } from "@/lib/ingredients";
import { formatNutritionUnit, getIngredientNutritionDisplay } from "@/lib/ingredient-nutrition-display";
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
    return { tone: "error", text: `Ошибка: ${params.error}` };
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
      <div className="mx-auto w-full max-w-[1480px]">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-1 text-2xl font-bold leading-tight">Ингредиенты</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={showArchived ? "/admin/ingredients" : "/admin/ingredients?view=archived"} className="inline-flex min-h-10 items-center rounded-md border border-karimoff-line bg-white px-3 py-2 text-sm font-semibold hover:text-karimoff-orange">
              {showArchived ? "Активные ингредиенты" : `Архив${archivedCount ? ` · ${archivedCount}` : ""}`}
            </Link>
            <Link href="/admin/ingredients/prices" className="inline-flex min-h-10 items-center rounded-md border border-karimoff-line bg-white px-3 py-2 text-sm font-semibold hover:text-karimoff-orange">
              Цены и упаковки
            </Link>
            <Link href="/admin/ingredients/new" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-karimoff-orange px-3 py-2 text-sm font-bold text-white hover:bg-[#D95405]">
              <Plus size={16} aria-hidden="true" />
              Создать ингредиент
            </Link>
            <form action={logoutAction}>
              <button type="submit" title="Выйти" aria-label="Выйти" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-karimoff-line bg-white hover:text-karimoff-orange">
                <LogOut size={16} aria-hidden="true" />
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

        <section className="mt-5 border-y border-karimoff-line bg-white">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">База данных не подключена. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : visibleIngredients.length === 0 ? (
            <div className="p-8 text-karimoff-muted">
              {showArchived ? "В архиве пока нет ингредиентов." : "Активных ингредиентов пока нет."}
            </div>
          ) : (
            <div className="relative overflow-x-auto" role="region" aria-label="Список ингредиентов" tabIndex={0}>
              <table className="admin-table min-w-[1080px] table-fixed [&_td]:!px-2 [&_td]:!py-2 [&_th]:!px-2 [&_th]:!py-2">
                <colgroup>
                  {[14, 8, 4, 7, 7, 13, 15, 15, 7, 10].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Название</th>
                    <th scope="col">Категория</th>
                    <th scope="col">Ед.</th>
                    <th scope="col">Остаток</th>
                    <th scope="col" title="Заказать, когда остаток равен порогу или ниже">Порог закупки</th>
                    <th scope="col">Себестоимость / упаковка</th>
                    <th scope="col">КБЖУ / 1 ед.<span className="block font-normal">ккал · Б / Ж / У, г</span></th>
                    <th scope="col">КБЖУ / 100 г<span className="block font-normal">ккал · Б / Ж / У, г</span></th>
                    <th scope="col">Статус</th>
                    <th scope="col">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIngredients.map((ingredient) => {
                    const inventoryItem = inventoryResult?.itemsByIngredient.get(ingredient.id) ?? null;
                    const isLow = inventoryItem && inventoryItem.min_quantity > 0 && inventoryItem.current_quantity <= inventoryItem.min_quantity;
                    const nutrition = getIngredientNutritionDisplay(ingredient);

                    return (
                      <tr key={ingredient.id} className="border-b border-karimoff-line last:border-b-0">
                        <td className="break-words">
                          <p className="font-semibold">{ingredient.name} <span className="text-xs font-normal text-karimoff-muted">#{ingredient.sort_order}</span></p>
                          <IngredientNutritionSource display={nutrition} />
                          {isLow ? <p className="mt-1 text-xs font-bold text-amber-700">Низкий остаток</p> : null}
                        </td>
                        <td className="break-words text-xs">{ingredient.category ?? "—"}</td>
                        <td className="text-xs">{formatNutritionUnit(ingredient.unit)}</td>
                        <td className={`text-xs font-semibold tabular-nums ${isLow ? "text-amber-800" : ""}`}>
                          {inventoryItem ? formatInventoryQuantity(inventoryItem.current_quantity, inventoryItem.unit) : "Карточка не создана"}
                        </td>
                        <td className="text-xs tabular-nums text-karimoff-muted">
                          {inventoryItem ? formatInventoryQuantity(inventoryItem.min_quantity, inventoryItem.unit) : "—"}
                        </td>
                        <td className="text-xs leading-5 tabular-nums">
                          <p className="font-semibold">{formatMoney(ingredient.cost_per_unit)} / {formatNutritionUnit(ingredient.unit)}</p>
                          <p className="text-karimoff-muted">
                            {ingredient.package_size && ingredient.package_price !== null
                              ? `${ingredient.package_size} ${formatNutritionUnit(ingredient.unit)} / ${formatMoney(ingredient.package_price)}`
                              : "Нет упаковки"}
                          </p>
                          <p className={ingredient.waste_percent > 0 ? "text-amber-700" : "text-karimoff-muted"}>Отходы: {ingredient.waste_percent}%</p>
                        </td>
                        <td>
                          <IngredientNutritionValues nutrition={nutrition.perUnit} issue={nutrition.issue} />
                        </td>
                        <td>
                          <IngredientNutritionValues nutrition={nutrition.per100g} issue={nutrition.massIssue ?? nutrition.issue} />
                        </td>
                        <td>
                          <span className={`inline-flex rounded px-1.5 py-1 text-xs font-semibold ${ingredient.is_active ? "bg-emerald-50 text-emerald-800" : "bg-karimoff-black/5 text-karimoff-muted"}`}>
                            {ingredient.is_active ? "Активен" : "Скрыт"}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Link href={`/admin/ingredients/${ingredient.id}/edit`} title="Редактировать ингредиент" aria-label={`Редактировать: ${ingredient.name}`} className="h-10 w-10 rounded-md border border-karimoff-line hover:text-karimoff-orange">
                              <Pencil size={16} aria-hidden="true" />
                            </Link>
                            {!inventoryItem && !inventoryResult?.error ? (
                              <form action={createInventoryItemAction}>
                                <input type="hidden" name="ingredient_id" value={ingredient.id} />
                                <input type="hidden" name="return_to" value="/admin/ingredients" />
                                <button type="submit" title="Создать складскую карточку" aria-label={`Создать складскую карточку: ${ingredient.name}`} className="h-10 w-10 rounded-md border border-karimoff-line hover:text-karimoff-orange">
                                  <PackagePlus size={16} aria-hidden="true" />
                                </button>
                              </form>
                            ) : null}
                            {ingredient.is_active ? (
                              <form action={archiveIngredientAction}>
                                <input type="hidden" name="id" value={ingredient.id} />
                                <ConfirmSubmitButton
                                  message={`Переместить ингредиент «${ingredient.name}» в архив? История заказов сохранится.`}
                                  title="В архив"
                                  aria-label={`В архив: ${ingredient.name}`}
                                  className="h-10 w-10 rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                                >
                                  <Archive size={16} aria-hidden="true" />
                                </ConfirmSubmitButton>
                              </form>
                            ) : (
                              <form action={toggleIngredientActiveAction}>
                                <input type="hidden" name="id" value={ingredient.id} />
                                <input type="hidden" name="next_active" value="true" />
                                <input type="hidden" name="return_to" value="/admin/ingredients?view=archived" />
                                <button type="submit" title="Вернуть в работу" aria-label={`Вернуть в работу: ${ingredient.name}`} className="h-10 w-10 rounded-md border border-karimoff-line text-emerald-800 hover:bg-emerald-50">
                                  <ArchiveRestore size={16} aria-hidden="true" />
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
