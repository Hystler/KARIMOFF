import type { Product } from "@/lib/product-types";

type ProductFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  product?: Product | null;
  submitLabel: string;
};

export function ProductForm({ action, product, submitLabel }: ProductFormProps) {
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
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="Обама"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Slug
          <input
            name="slug"
            required
            defaultValue={product?.slug ?? ""}
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="obama"
          />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Категория
          <input
            name="category"
            required
            defaultValue={product?.category ?? "burgers"}
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
            placeholder="burgers"
          />
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
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
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
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        Фото URL
        <input
          name="image_url"
          defaultValue={product?.image_url ?? ""}
          className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none transition focus:border-karimoff-orange"
          placeholder="/assets/burger-obama.png или https://..."
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        Описание
        <textarea
          name="description"
          rows={5}
          defaultValue={product?.description ?? ""}
          className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-karimoff-orange"
          placeholder="Короткое описание позиции"
        />
      </label>

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
          className="rounded-full bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-karimoff-black"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
