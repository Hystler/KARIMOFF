import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIngredients } from "@/lib/ingredients";
import { updateIngredientPriceAction } from "../actions";

type IngredientPricesPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

const unitLabels = { g: "г", ml: "мл", pcs: "шт." } as const;

function formatCost(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value);
}

export default async function IngredientPricesPage({ searchParams }: IngredientPricesPageProps) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");

  const params = searchParams ? await searchParams : {};
  const { ingredients, notConfigured, error } = await getAdminIngredients();
  const missingPriceCount = ingredients.filter((ingredient) => ingredient.cost_per_unit <= 0).length;

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <Link href="/admin/ingredients" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Ингредиенты
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Цены и упаковки</h1>
            <p className="mt-3 text-sm leading-6 text-karimoff-muted sm:text-base">
              Укажите размер закупочной упаковки и её цену. Система сама рассчитает стоимость за 1 г, мл или штуку и сразу обновит food cost всех блюд.
            </p>
          </div>
          <div className={`w-fit rounded-lg border px-4 py-3 text-sm font-bold ${missingPriceCount ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {missingPriceCount ? `Без цены: ${missingPriceCount}` : "Все цены заполнены"}
          </div>
        </header>

        {params.error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {params.error === "save" ? "Не удалось сохранить цену. Повторите попытку." : decodeURIComponent(params.error)}
          </div>
        ) : null}

        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">База данных не подключена.</div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">Не удалось загрузить ингредиенты.</div>
        ) : (
          <section className="mt-8 overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-card">
            <div className="hidden grid-cols-[minmax(200px,1.2fr)_120px_145px_150px_110px_130px] gap-4 border-b border-karimoff-line bg-karimoff-soft px-5 py-4 text-xs font-bold text-karimoff-muted lg:grid">
              <span>Ингредиент</span>
              <span>Размер упаковки</span>
              <span>Цена упаковки</span>
              <span>₽ за 1 ед.</span>
              <span>Отходы, %</span>
              <span>Действие</span>
            </div>
            <div className="divide-y divide-karimoff-line">
              {ingredients.map((ingredient) => {
                const saved = params.saved === ingredient.id;
                return (
                  <form
                    key={ingredient.id}
                    action={updateIngredientPriceAction}
                    className={`grid gap-4 px-5 py-5 transition lg:grid-cols-[minmax(200px,1.2fr)_120px_145px_150px_110px_130px] lg:items-end ${saved ? "bg-emerald-50/70" : "hover:bg-karimoff-soft/45"}`}
                  >
                    <input type="hidden" name="id" value={ingredient.id} />
                    <div className="self-center">
                      <p className="font-bold text-karimoff-black">{ingredient.name}</p>
                      <p className="mt-1 text-xs text-karimoff-muted">
                        {ingredient.category ?? "Без категории"} · {unitLabels[ingredient.unit]}
                      </p>
                    </div>
                    <label className="grid gap-1.5 text-xs font-bold text-karimoff-muted">
                      <span className="lg:hidden">Размер упаковки</span>
                      <div className="relative">
                        <input
                          name="package_size"
                          type="number"
                          min="0.001"
                          step="0.001"
                          defaultValue={ingredient.package_size ?? ""}
                          placeholder="1000"
                          className="w-full rounded-lg border border-karimoff-line bg-white px-3 py-2.5 pr-11 text-sm font-semibold text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_3px_rgba(251,103,10,0.10)]"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-karimoff-muted">{unitLabels[ingredient.unit]}</span>
                      </div>
                    </label>
                    <label className="grid gap-1.5 text-xs font-bold text-karimoff-muted">
                      <span className="lg:hidden">Цена упаковки</span>
                      <div className="relative">
                        <input
                          name="package_price"
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={ingredient.package_price ?? ""}
                          placeholder="500"
                          className="w-full rounded-lg border border-karimoff-line bg-white px-3 py-2.5 pr-9 text-sm font-semibold text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_3px_rgba(251,103,10,0.10)]"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-karimoff-muted">₽</span>
                      </div>
                    </label>
                    <label className="grid gap-1.5 text-xs font-bold text-karimoff-muted">
                      <span className="lg:hidden">Стоимость за 1 {unitLabels[ingredient.unit]}</span>
                      <div className="relative">
                        <input
                          name="cost_per_unit"
                          type="number"
                          min="0"
                          step="0.0001"
                          defaultValue={ingredient.cost_per_unit > 0 ? ingredient.cost_per_unit : ""}
                          placeholder="Рассчитается"
                          className="w-full rounded-lg border border-karimoff-line bg-white px-3 py-2.5 pr-9 text-sm font-semibold text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_3px_rgba(251,103,10,0.10)]"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-karimoff-muted">₽</span>
                      </div>
                      {ingredient.cost_per_unit > 0 ? <span className="font-medium text-karimoff-muted">Сейчас: {formatCost(ingredient.cost_per_unit)} ₽</span> : null}
                    </label>
                    <label className="grid gap-1.5 text-xs font-bold text-karimoff-muted">
                      <span className="lg:hidden">Отходы, %</span>
                      <input
                        name="waste_percent"
                        type="number"
                        min="0"
                        max="95"
                        step="0.1"
                        defaultValue={ingredient.waste_percent}
                        className="w-full rounded-lg border border-karimoff-line bg-white px-3 py-2.5 text-sm font-semibold text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_3px_rgba(251,103,10,0.10)]"
                      />
                    </label>
                    <button type="submit" className="min-h-11 rounded-full bg-karimoff-black px-5 py-2.5 text-sm font-bold text-white transition hover:bg-karimoff-orange focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-karimoff-orange/20">
                      {saved ? "Сохранено" : "Сохранить"}
                    </button>
                  </form>
                );
              })}
            </div>
          </section>
        )}

        <p className="mt-5 max-w-3xl text-sm leading-6 text-karimoff-muted">
          Пример: упаковка соуса 1 000 г стоит 500 ₽ — себестоимость составит 0,5 ₽/г. Для штучного товара укажите количество штук в упаковке. Если закупочной упаковки нет, оставьте первые два поля пустыми и внесите стоимость за единицу вручную.
        </p>
      </div>
    </main>
  );
}
