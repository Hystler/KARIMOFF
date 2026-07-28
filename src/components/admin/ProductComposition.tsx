import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import {
  addProductIngredientAction,
  deleteProductIngredientAction,
  updateProductIngredientAction
} from "@/app/admin/products/composition-actions";
import type { Ingredient, ProductFoodCost } from "@/lib/ingredients";

type ProductCompositionProps = {
  productId: string;
  productPrice: number;
  ingredients: Ingredient[];
  foodCost: ProductFoodCost;
};

function formatMoney(value: number | null) {
  if (value === null) {
    return "не задан";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "не задан";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function ProductComposition({ productId, productPrice, ingredients, foodCost }: ProductCompositionProps) {
  const activeIngredients = ingredients.filter((ingredient) => ingredient.is_active);

  return (
    <section className="mt-8 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-karimoff-orange">Состав</p>
          <h2 className="mt-2 text-2xl font-black leading-tight text-karimoff-black">Состав и себестоимость</h2>
        </div>
        <div className="grid gap-1 rounded-lg bg-karimoff-soft px-4 py-3 text-sm">
          <span className="font-semibold text-karimoff-muted">Себестоимость блюда</span>
          <span className="admin-number text-xl font-black text-karimoff-orange">{formatMoney(foodCost.food_cost)}</span>
          <span className="font-bold text-karimoff-black">{formatPercent(foodCost.food_cost_percent)} от цены {formatMoney(productPrice)}</span>
        </div>
      </div>

      {foodCost.lines.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-karimoff-line bg-karimoff-cream p-5 text-sm leading-6 text-karimoff-muted">
          Состав не задан. Добавьте ингредиенты, чтобы увидеть себестоимость товара.
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {foodCost.lines.map((line) => (
            <form key={line.id} action={updateProductIngredientAction} className="grid gap-3 rounded-lg border border-karimoff-line p-4 lg:grid-cols-[1.2fr_0.45fr_0.35fr_0.35fr_auto] lg:items-end">
              <input type="hidden" name="id" value={line.id} />
              <input type="hidden" name="product_id" value={productId} />
              <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
                Ингредиент
                <select name="ingredient_id" defaultValue={line.ingredient_id} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange">
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name} — {formatMoney(ingredient.cost_per_unit)} / {ingredient.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
                Количество
                <input name="quantity" type="number" min="0.001" step="0.001" defaultValue={line.quantity} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange" />
              </label>
              <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
                Ед.
                <select name="unit" defaultValue={line.unit} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange">
                  <option value="g">г</option>
                  <option value="ml">мл</option>
                  <option value="pcs">шт.</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
                Порядок
                <input name="sort_order" type="number" min="0" step="1" defaultValue={line.sort_order} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-karimoff-orange/10 px-3 py-2 text-xs font-black text-karimoff-orange">
                  {formatMoney(line.line_cost)}
                </span>
                <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-[#D95405]">
                  Сохранить
                </button>
                <ConfirmSubmitButton
                  formAction={deleteProductIngredientAction}
                  message={`Удалить ингредиент «${line.ingredient_name}» из состава?`}
                  className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                >
                  Удалить
                </ConfirmSubmitButton>
              </div>
              <fieldset className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-cream/60 p-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-5">
                <legend className="px-2 text-xs font-black text-karimoff-black">Настройка для гостя</legend>
                <label className="flex items-center gap-2 text-xs font-bold text-karimoff-muted">
                  <input type="checkbox" name="is_removable" defaultChecked={line.is_removable} className="h-5 w-5 accent-karimoff-orange" />
                  Можно убрать
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-karimoff-muted">
                  <input type="checkbox" name="is_extra_available" defaultChecked={line.is_extra_available} className="h-5 w-5 accent-karimoff-orange" />
                  Можно добавить
                </label>
                <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
                  Порция добавки
                  <input name="extra_quantity" type="number" min="0" step="0.001" defaultValue={line.extra_quantity} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
                  Доплата, ₽
                  <input name="extra_price" type="number" min="0" step="1" defaultValue={line.extra_price} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
                </label>
                <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
                  Максимум порций
                  <input name="max_extra_quantity" type="number" min="1" max="10" step="1" defaultValue={line.max_extra_quantity} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
                </label>
              </fieldset>
            </form>
          ))}
        </div>
      )}

      <form action={addProductIngredientAction} className="mt-6 grid gap-3 rounded-lg border border-karimoff-orange/20 bg-karimoff-orange/5 p-4 lg:grid-cols-[1.2fr_0.45fr_0.35fr_0.35fr_auto] lg:items-end">
        <input type="hidden" name="product_id" value={productId} />
        <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
          Добавить ингредиент
          <select name="ingredient_id" required className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange">
            <option value="">Выберите</option>
            {activeIngredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name} — {formatMoney(ingredient.cost_per_unit)} / {ingredient.unit}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
          Количество
          <input name="quantity" required type="number" min="0.001" step="0.001" className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange" placeholder="120" />
        </label>
        <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
          Ед.
          <select name="unit" defaultValue="g" className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange">
            <option value="g">г</option>
            <option value="ml">мл</option>
            <option value="pcs">шт.</option>
          </select>
        </label>
        <label className="grid gap-2 text-xs font-bold text-karimoff-muted">
          Порядок
          <input name="sort_order" type="number" min="0" step="1" defaultValue={100} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black outline-none focus:border-karimoff-orange" />
        </label>
        <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405]">
          Добавить
        </button>
        <fieldset className="grid gap-3 rounded-lg border border-karimoff-orange/20 bg-white p-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-5">
          <legend className="px-2 text-xs font-black text-karimoff-black">Настройка для гостя</legend>
          <label className="flex items-center gap-2 text-xs font-bold text-karimoff-muted">
            <input type="checkbox" name="is_removable" className="h-5 w-5 accent-karimoff-orange" />
            Можно убрать
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-karimoff-muted">
            <input type="checkbox" name="is_extra_available" className="h-5 w-5 accent-karimoff-orange" />
            Можно добавить
          </label>
          <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
            Порция добавки
            <input name="extra_quantity" type="number" min="0" step="0.001" defaultValue={0} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
          </label>
          <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
            Доплата, ₽
            <input name="extra_price" type="number" min="0" step="1" defaultValue={0} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
          </label>
          <label className="grid gap-1 text-xs font-bold text-karimoff-muted">
            Максимум порций
            <input name="max_extra_quantity" type="number" min="1" max="10" step="1" defaultValue={1} className="rounded-lg border border-karimoff-line bg-white px-3 py-2 text-sm text-karimoff-black" />
          </label>
        </fieldset>
      </form>
    </section>
  );
}
