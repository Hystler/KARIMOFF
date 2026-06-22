import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import type { ProductImage } from "@/lib/product-types";
import {
  deleteProductImageAction,
  setPrimaryProductImageAction,
  updateProductImageAction,
  uploadProductImagesAction
} from "@/app/admin/products/actions";

type ProductImagesManagerProps = {
  images: ProductImage[];
  productId: string;
  productName: string;
};

export function ProductImagesManager({ images, productId, productName }: ProductImagesManagerProps) {
  return (
    <section className="mt-8 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
      <div className="grid gap-2">
        <p className="text-sm font-semibold text-karimoff-orange">Фотографии товара</p>
        <h2 className="text-2xl font-black">Галерея SKU</h2>
        <p className="max-w-2xl text-sm leading-6 text-karimoff-muted">
          Добавьте 1-5 фото товара. Рекомендуемый формат: квадрат или 4:3,
          WebP/JPG до 3 MB. Продукт должен быть по центру, без текста по краям.
        </p>
      </div>

      <form action={uploadProductImagesAction} className="mt-5 grid gap-3 rounded-xl border border-dashed border-karimoff-line bg-karimoff-cream/70 p-4">
        <input type="hidden" name="id" value={productId} />
        <label className="grid gap-2 text-sm font-semibold">
          Загрузить фото
          <input
            name="images"
            type="file"
            accept="image/*"
            multiple
            className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-karimoff-orange file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
          />
        </label>
        <button
          type="submit"
          className="w-fit rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
        >
          Добавить фото
        </button>
      </form>

      {images.length === 0 ? (
        <div className="mt-5 rounded-xl border border-karimoff-line bg-karimoff-soft p-5 text-sm leading-6 text-karimoff-muted">
          Фото пока нет. На сайте будет использоваться старое поле “Фото URL” или placeholder.
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          {images.map((image) => (
            <article key={image.id} className="grid gap-4 rounded-xl border border-karimoff-line bg-karimoff-cream/70 p-4 md:grid-cols-[180px_1fr]">
              <div className="overflow-hidden rounded-xl border border-karimoff-line bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.image_url}
                  alt={image.alt ?? productName}
                  className="h-40 w-full object-contain"
                />
              </div>
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {image.is_primary ? (
                    <span className="rounded-full bg-karimoff-orange px-3 py-1 text-xs font-black text-white">Главное фото</span>
                  ) : (
                    <form action={setPrimaryProductImageAction}>
                      <input type="hidden" name="id" value={productId} />
                      <input type="hidden" name="image_id" value={image.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-karimoff-orange px-3 py-1.5 text-xs font-bold text-karimoff-orange transition hover:bg-karimoff-orange hover:text-white"
                      >
                        Сделать главным
                      </button>
                    </form>
                  )}
                  <span className="text-xs font-semibold text-karimoff-muted">Порядок: {image.sort_order}</span>
                </div>

                <form action={updateProductImageAction} className="grid gap-3 md:grid-cols-[1fr_140px_auto] md:items-end">
                  <input type="hidden" name="id" value={productId} />
                  <input type="hidden" name="image_id" value={image.id} />
                  <label className="grid gap-2 text-sm font-semibold">
                    Alt-текст
                    <input
                      name="alt"
                      defaultValue={image.alt ?? ""}
                      className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none focus:border-karimoff-orange"
                      placeholder={productName}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold">
                    Порядок
                    <input
                      name="sort_order"
                      type="number"
                      step="1"
                      defaultValue={image.sort_order}
                      className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm outline-none focus:border-karimoff-orange"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-full border border-karimoff-line bg-white px-4 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
                  >
                    Сохранить
                  </button>
                </form>

                <form action={deleteProductImageAction}>
                  <input type="hidden" name="id" value={productId} />
                  <input type="hidden" name="image_id" value={image.id} />
                  <ConfirmSubmitButton
                    message={`Удалить фото товара «${productName}»?`}
                    className="rounded-full border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50"
                  >
                    Удалить фото
                  </ConfirmSubmitButton>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

