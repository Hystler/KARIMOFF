import type { Product } from "@/lib/product-types";
import { adminProductCategoryOptions } from "@/lib/product-categories";

type ProductFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  product?: Product | null;
  submitLabel: string;
};

export function ProductForm({ action, product, submitLabel }: ProductFormProps) {
  const currentCategory = product?.category ?? "Бургеры";
  const categoryOptions = adminProductCategoryOptions.includes(currentCategory)
    ? adminProductCategoryOptions
    : [currentCategory, ...adminProductCategoryOptions];

  return (
    <form action={action} className="mt-8 grid gap-5 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Название
          <input
            name="name"
            required
            defaultValue={product?.name ?? ""}
            className="min-h-12 rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="Название позиции"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Slug
          <input
            name="slug"
            required
            defaultValue={product?.slug ?? ""}
            className="min-h-12 rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="nazvanie-pozitsii"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        Короткое описание для гостя
        <textarea
          name="description"
          rows={4}
          defaultValue={product?.description ?? ""}
          className="resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-karimoff-orange"
          placeholder="Честно опишите вкус и особенности блюда в 1–3 предложениях"
        />
        <span className="text-xs font-medium leading-5 text-karimoff-muted">
          Это текст для карточки и страницы товара. Фактический состав редактируется отдельно в блоке «Состав и себестоимость».
        </span>
      </label>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Категория
          <select
            name="category"
            required
            defaultValue={product?.category ?? "Бургеры"}
            className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Цена, ₽
          <input
            name="price"
            required
            type="number"
            min="0"
            step="1"
            defaultValue={product?.price ?? 0}
            className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Порядок
          <input
            name="sort_order"
            required
            type="number"
            min="0"
            step="1"
            defaultValue={product?.sort_order ?? 100}
            className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        Фото URL
        <input
          name="image_url"
          defaultValue={product?.image_url ?? ""}
          className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          placeholder="/assets/products/placeholder-burger.svg или https://..."
        />
        {!product ? (
          <span className="text-xs leading-5 text-karimoff-muted">
            Несколько фото можно добавить после создания товара на странице редактирования.
          </span>
        ) : (
          <span className="text-xs leading-5 text-karimoff-muted">
            Это fallback-изображение. Основная галерея настраивается ниже в блоке “Фотографии товара”.
          </span>
        )}
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Вес / объём порции
          <input
            name="weight"
            defaultValue={product?.weight ?? ""}
            className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="Например, 320 г"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Аллергены
          <input
            name="allergens"
            defaultValue={product?.allergens?.join(", ") ?? ""}
            className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="Заполняйте только подтверждённые сведения"
          />
          <span className="text-xs font-medium leading-5 text-amber-700">
            Если точный перечень не подтверждён, оставьте поле пустым. Не генерируйте аллергены автоматически.
          </span>
        </label>
      </div>

      <fieldset className="grid gap-4 rounded-lg border border-karimoff-line p-4">
        <legend className="px-2 text-sm font-bold text-karimoff-black">КБЖУ на порцию</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ["calories", "Ккал", product?.calories],
            ["protein", "Белки, г", product?.protein],
            ["fat", "Жиры, г", product?.fat],
            ["carbs", "Углеводы, г", product?.carbs]
          ].map(([name, label, value]) => (
            <label key={String(name)} className="grid gap-2 text-sm font-semibold text-karimoff-black">
              {String(label)}
              <input
                name={String(name)}
                type="number"
                min="0"
                step="0.1"
                defaultValue={value ?? ""}
                className="rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
              />
            </label>
          ))}
        </div>
        <p className="text-xs font-medium leading-5 text-karimoff-muted">
          Заполняйте только подтверждённые значения. Пустые поля на сайте показываются как «Данные уточняются», а не как нули.
        </p>
      </fieldset>

      <label className="flex items-center gap-3 text-sm font-semibold text-karimoff-black">
        <input
          name="is_active"
          type="checkbox"
          defaultChecked={product?.is_active ?? true}
          className="h-5 w-5 accent-karimoff-orange"
        />
        Показывать на сайте
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          className="min-h-12 w-full rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] active:translate-y-0 sm:w-auto"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
