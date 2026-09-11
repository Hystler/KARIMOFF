import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, Pencil, Plus, Save } from "lucide-react";
import { IngredientNutritionSource, IngredientNutritionValues } from "@/components/admin/IngredientNutritionDisplay";
import { getCurrentStaff } from "@/lib/admin-auth";
import { listExtrasCatalog } from "@/lib/extras-service";
import { getAdminIngredients } from "@/lib/ingredients";
import { formatNutritionUnit, getIngredientNutritionDisplay } from "@/lib/ingredient-nutrition-display";
import { installExtrasAction, updateExtraPriceAction } from "./actions";

export const dynamic = "force-dynamic";

function rub(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value);
}

export default async function ExtrasPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin"].includes(staff.role)) redirect("/admin/login");

  const params = await searchParams;
  const extras = await listExtrasCatalog();
  const { ingredients, error: ingredientError, notConfigured } = await getAdminIngredients();
  const ingredientsById = new Map(ingredients.map(ingredient => [ingredient.id, ingredient]));

  return <main className="admin-content admin-content-wide">
    <div>
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Меню и состав</p>
          <h1>Допы к блюдам</h1>
          <p>Три уместных варианта для каждого блюда, порция и пищевая ценность.</p>
        </div>
        <form action={installExtrasAction}>
          <button className="admin-primary-button" type="submit">
            <Plus size={16} aria-hidden="true" />
            {extras.length ? "Добавить к новым блюдам" : "Добавить допы в каталог"}
          </button>
        </form>
      </header>

      {params.saved ? <p className="admin-alert admin-alert-success mt-5">Допы сохранены.</p> : null}
      {params.error ? <p className="admin-alert admin-alert-error mt-5">{params.error}</p> : null}
      {ingredientError || notConfigured ? <p className="mt-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        КБЖУ ингредиентов недоступны: {ingredientError ?? "база данных не подключена"}.
      </p> : null}

      <section className="admin-metrics mt-5" aria-label="Сводка допов">
        <article><span>Доступных допов</span><strong>{extras.length}</strong></article>
        <article><span>Связей с блюдами</span><strong>{extras.reduce((sum, extra) => sum + extra.product_count, 0)}</strong></article>
        <article><span>Максимум на блюдо</span><strong>3</strong></article>
      </section>

      <section className="admin-card mt-5 overflow-hidden">
        {!extras.length ? <p className="p-8 text-karimoff-muted">Допы ещё не добавлены.</p> : (
          <div className="relative overflow-x-auto" role="region" aria-label="Список допов" tabIndex={0}>
            <table className="admin-table min-w-[1080px] table-fixed [&_td]:!px-2 [&_td]:!py-2 [&_th]:!px-2 [&_th]:!py-2">
              <colgroup>
                {[16, 8, 6, 13, 13, 13, 11, 5, 15].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Название</th>
                  <th scope="col">Категория</th>
                  <th scope="col">Ед. / порция</th>
                  <th scope="col">КБЖУ / 1 ед.<span className="block font-normal">ккал · Б / Ж / У, г</span></th>
                  <th scope="col">КБЖУ / доп<span className="block font-normal">ккал · Б / Ж / У, г</span></th>
                  <th scope="col">КБЖУ / 100 г<span className="block font-normal">ккал · Б / Ж / У, г</span></th>
                  <th scope="col">Себестоимость</th>
                  <th scope="col">Блюд</th>
                  <th scope="col">Цена для гостя, ₽</th>
                </tr>
              </thead>
              <tbody>
                {extras.map(extra => {
                  const ingredient = ingredientsById.get(extra.ingredient_id) ?? null;
                  const quantity = Number(extra.quantity);
                  const price = Number(extra.price);
                  const rawCost = Number(extra.cost) * quantity / (1 - Number(extra.waste) / 100);
                  const cost = Number(extra.cost) > 0 && quantity > 0 && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;
                  const foodCostPercent = cost !== null && Number.isFinite(price) && price > 0 ? cost / price * 100 : null;
                  const nutrition = getIngredientNutritionDisplay(ingredient, quantity, extra.unit);
                  const pricesDiffer = price !== Number(extra.price_max);

                  return <tr key={`${extra.ingredient_id}:${extra.label}:${extra.unit}`}>
                    <td className="break-words">
                      <p className="font-semibold">{extra.label}</p>
                      <IngredientNutritionSource display={nutrition} />
                      {extra.note ? <details className="group mt-1 text-xs leading-5 text-amber-800">
                        <summary className="flex cursor-pointer items-center gap-1 font-semibold">Порция требует сверки<ChevronDown size={14} className="transition-transform group-open:rotate-180" /></summary>
                        <p>{extra.note}</p>
                      </details> : null}
                    </td>
                    <td className="break-words text-xs">{ingredient?.category ?? "—"}</td>
                    <td className="text-xs tabular-nums">{Number.isFinite(quantity) && quantity > 0 ? extra.quantity : "Не указана"} {formatNutritionUnit(extra.unit)}</td>
                    <td><IngredientNutritionValues nutrition={nutrition.perUnit} issue={nutrition.issue} /></td>
                    <td><IngredientNutritionValues nutrition={nutrition.perPortion} issue={nutrition.issue ?? "Порция не задана"} /></td>
                    <td><IngredientNutritionValues nutrition={nutrition.per100g} issue={nutrition.massIssue ?? nutrition.issue} /></td>
                    <td className="text-xs leading-5 tabular-nums">
                      <p className={cost === null ? "font-semibold text-amber-800" : "font-semibold"}>{cost === null ? "Нет закупочной цены" : rub(cost)}</p>
                      <p className="text-karimoff-muted">Food cost: {foodCostPercent === null ? "Нет данных" : `${foodCostPercent.toFixed(1)}%`}</p>
                    </td>
                    <td className="text-xs tabular-nums">{extra.product_count}</td>
                    <td>
                      <form action={updateExtraPriceAction} className="flex items-center gap-1">
                        <input type="hidden" name="ingredient_id" value={extra.ingredient_id} />
                        <input type="hidden" name="label" value={extra.label} />
                        <label className="min-w-0 flex-1">
                          <span className="sr-only">Цена для гостя: {extra.label}, ₽</span>
                          <input name="price" required inputMode="decimal" defaultValue={extra.price} className="h-10 w-full rounded-md border border-karimoff-line bg-white px-2 text-sm tabular-nums" />
                        </label>
                        <button type="submit" title="Сохранить цену для всех блюд" aria-label={`Сохранить цену: ${extra.label}`} className="h-10 w-10 shrink-0 rounded-md bg-karimoff-black text-white hover:bg-black/80">
                          <Save size={16} aria-hidden="true" />
                        </button>
                        <Link href={`/admin/ingredients/${extra.ingredient_id}/edit`} title="Закупочная стоимость ингредиента" aria-label={`Редактировать ингредиент: ${extra.name}`} className="h-10 w-10 shrink-0 rounded-md border border-karimoff-line hover:text-karimoff-orange">
                          <Pencil size={16} aria-hidden="true" />
                        </Link>
                      </form>
                      {pricesDiffer ? <p className="mt-1 text-xs leading-4 text-amber-800">Цены: {rub(price)}–{rub(Number(extra.price_max))}. Сохранение установит единую цену.</p> : null}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  </main>;
}
