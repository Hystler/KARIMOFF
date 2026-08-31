import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getProductsFoodCosts, type ProductFoodCost } from "@/lib/ingredients";
import type { Product } from "@/lib/product-types";
import { getAdminProducts } from "@/lib/products";
import { logoutAction } from "../login/actions";
import { deleteProductAction, toggleProductActiveAction } from "./actions";

type AdminProductsPageProps = {
  searchParams?: Promise<{
    deleted?: string;
    error?: string;
    saved?: string;
  }>;
};

export const dynamic = "force-dynamic";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoney(value: number | null) {
  if (value === null) {
    return "не задан";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

function foodCostTone(value: number | null) {
  if (value === null) {
    return "bg-amber-50 text-amber-700";
  }

  if (value < 30) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (value < 40) {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

function ProductWarnings({ foodCost, product }: { foodCost?: ProductFoodCost; product: Product }) {
  const warnings = [
    foodCost && foodCost.lines.length === 0 ? "Состав не задан" : null,
    foodCost?.missing_price_ingredients.length
      ? `Нет цены: ${foodCost.missing_price_ingredients.join(", ")}`
      : null,
    !product.allergens?.length ? "Не заполнены аллергены" : null
  ].filter((warning): warning is string => Boolean(warning));

  if (!warnings.length) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-amber-700">
      {warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
    </div>
  );
}

function ProductActions({ product }: { product: Product }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/admin/products/${product.id}/edit`}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-karimoff-line px-3.5 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange"
      >
        Изменить
      </Link>
      <form action={toggleProductActiveAction}>
        <input type="hidden" name="id" value={product.id} />
        <input type="hidden" name="next_active" value={String(!product.is_active)} />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-karimoff-line px-3.5 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange"
        >
          {product.is_active ? "Скрыть" : "Показать"}
        </button>
      </form>
      <form action={deleteProductAction}>
        <input type="hidden" name="id" value={product.id} />
        <ConfirmSubmitButton
          message={`Удалить товар «${product.name}»?`}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-200 px-3.5 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
        >
          Удалить
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

function getMessage(params: Awaited<NonNullable<AdminProductsPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Изменения сохранены." };
  }

  if (params.deleted) {
    return { tone: "success", text: "Товар удалён." };
  }

  if (params.error === "database") {
    return { tone: "error", text: "База данных не подключена. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
  }

  return null;
}

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { products, notConfigured, error } = await getAdminProducts();
  const foodCostsResult = error ? null : await getProductsFoodCosts(products);
  const foodCostsByProduct = new Map(foodCostsResult?.items.map((item) => [item.product.id, item]) ?? []);

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="admin-page-title">Меню</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-karimoff-muted">
              Товары, состав, себестоимость и доступность на сайте.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/admin/products/new"
              className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              Создать товар
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
              >
                Выйти
              </button>
            </form>
          </div>
        </header>

        {message ? (
          <div
            className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${
              message.tone === "success"
                ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <section className="admin-panel mt-7 overflow-hidden">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">База данных не подключена. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить товары: {error}</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Товаров пока нет. Создайте первую позицию меню.</div>
          ) : (
            <>
              {foodCostsResult?.error ? (
                <div className="border-b border-karimoff-line px-5 py-4 text-sm font-semibold text-amber-700">
                  Себестоимость временно недоступна: {foodCostsResult.error}
                </div>
              ) : null}

              <div className="grid gap-3 p-3 lg:hidden">
                {products.map((product) => {
                  const foodCost = foodCostsByProduct.get(product.id);

                  return (
                    <article key={product.id} className="min-w-0 overflow-hidden rounded-lg border border-karimoff-line bg-white p-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-karimoff-line bg-[#F8F2EA] p-2">
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.image_url} alt={product.name} className="h-full w-full object-contain" />
                          ) : (
                            <span className="text-[11px] font-semibold text-karimoff-muted">нет фото</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="text-base font-black leading-5">{product.name}</h2>
                              <p className="mt-1 truncate text-xs text-karimoff-muted">
                                {product.category} · {product.slug}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                product.is_active
                                  ? "bg-karimoff-orange/10 text-karimoff-orange"
                                  : "bg-karimoff-black/5 text-karimoff-muted"
                              }`}
                            >
                              {product.is_active ? "Активен" : "Скрыт"}
                            </span>
                          </div>
                          <ProductWarnings foodCost={foodCost} product={product} />
                        </div>
                      </div>

                      <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-3 gap-y-4 border-y border-karimoff-line py-3 text-xs">
                        <div className="min-w-0">
                          <dt className="text-karimoff-muted">Цена</dt>
                          <dd className="admin-number mt-1 font-black text-karimoff-orange">
                            {formatPrice(product.price)} ₽
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-karimoff-muted">Себестоимость</dt>
                          <dd className="admin-number mt-1 font-bold">{formatMoney(foodCost?.food_cost ?? null)}</dd>
                          <dd className="mt-1 font-bold">{formatPercent(foodCost?.food_cost_percent ?? null)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-karimoff-muted">Прибыль с единицы</dt>
                          <dd className="admin-number mt-1 font-bold">{formatMoney(foodCost?.gross_profit ?? null)}</dd>
                          <dd className="mt-1 font-bold">Маржа {formatPercent(foodCost?.gross_margin_percent ?? null)}</dd>
                        </div>
                      </dl>

                      <div className="mt-3">
                        <ProductActions product={product} />
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="admin-table min-w-[1040px]">
                  <thead>
                    <tr>
                      <th className="w-[88px]">Фото</th>
                      <th className="min-w-[310px]">Товар</th>
                      <th className="w-[120px]">Цена</th>
                      <th className="w-[165px]">Себестоимость</th>
                      <th className="w-[165px]">Прибыль с единицы</th>
                      <th className="w-[110px]">Статус</th>
                      <th className="min-w-[250px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const foodCost = foodCostsByProduct.get(product.id);

                      return (
                        <tr key={product.id}>
                          <td>
                            <div className="flex h-14 w-[72px] items-center justify-center overflow-hidden rounded-lg border border-karimoff-line bg-[#F8F2EA] p-2">
                              {product.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={product.image_url} alt={product.name} className="h-full w-full object-contain" />
                              ) : (
                                <span className="text-[11px] font-semibold text-karimoff-muted">нет фото</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <p className="max-w-[360px] font-bold leading-5">{product.name}</p>
                            <p className="mt-1 text-xs leading-5 text-karimoff-muted">
                              № {product.sort_order} · {product.category} · {product.slug}
                            </p>
                            <ProductWarnings foodCost={foodCost} product={product} />
                          </td>
                          <td className="admin-number whitespace-nowrap font-black text-karimoff-orange">
                            {formatPrice(product.price)} ₽
                          </td>
                          <td>
                            <p className="admin-number whitespace-nowrap font-bold">
                              {formatMoney(foodCost?.food_cost ?? null)}
                            </p>
                            <span
                              className={`mt-1.5 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${foodCostTone(foodCost?.food_cost_percent ?? null)}`}
                            >
                              {formatPercent(foodCost?.food_cost_percent ?? null)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">
                            <p className="admin-number font-bold">{formatMoney(foodCost?.gross_profit ?? null)}</p>
                            <p className="mt-1 text-xs font-bold text-karimoff-muted">
                              Маржа {formatPercent(foodCost?.gross_margin_percent ?? null)}
                            </p>
                          </td>
                          <td>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                                product.is_active
                                  ? "bg-karimoff-orange/10 text-karimoff-orange"
                                  : "bg-karimoff-black/5 text-karimoff-muted"
                              }`}
                            >
                              {product.is_active ? "Активен" : "Скрыт"}
                            </span>
                          </td>
                          <td>
                            <ProductActions product={product} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
