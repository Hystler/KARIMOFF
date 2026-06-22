import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getProductsFoodCosts } from "@/lib/ingredients";
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

function getMessage(params: Awaited<NonNullable<AdminProductsPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Изменения сохранены." };
  }

  if (params.deleted) {
    return { tone: "success", text: "Товар удалён." };
  }

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
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
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Меню</h1>
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

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить товары: {error}</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Товаров пока нет. Создайте первую позицию меню.</div>
          ) : (
            <div className="overflow-x-auto">
              {foodCostsResult?.error ? (
                <div className="border-b border-karimoff-line px-5 py-4 text-sm font-semibold text-amber-700">
                  Food cost временно недоступен: {foodCostsResult.error}
                </div>
              ) : null}
              <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Фото</th>
                    <th className="px-4 py-4 font-bold">Порядок</th>
                    <th className="px-4 py-4 font-bold">Название</th>
                    <th className="px-4 py-4 font-bold">Категория</th>
                    <th className="px-4 py-4 font-bold">Цена</th>
                    <th className="px-4 py-4 font-bold">Food cost</th>
                    <th className="px-4 py-4 font-bold">Food cost %</th>
                    <th className="px-4 py-4 font-bold">Gross profit</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const foodCost = foodCostsByProduct.get(product.id);

                    return (
                      <tr key={product.id} className="border-b border-karimoff-line last:border-b-0">
                        <td className="px-4 py-4">
                          <div className="flex h-16 w-20 items-center justify-center overflow-hidden rounded-xl border border-karimoff-line bg-[#F8F2EA] p-2">
                            {product.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={product.image_url} alt={product.name} className="h-full w-full object-contain" />
                            ) : (
                              <span className="text-[10px] font-semibold text-karimoff-muted">нет фото</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-karimoff-muted">{product.sort_order}</td>
                        <td className="px-4 py-4">
                          <p className="font-semibold">{product.name}</p>
                          <p className="mt-1 text-xs text-karimoff-muted">{product.slug}</p>
                          {foodCost?.food_cost === null ? (
                            <p className="mt-2 text-xs font-bold text-amber-700">Состав не задан</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">{product.category}</td>
                        <td className="px-4 py-4 font-black text-karimoff-orange">{formatPrice(product.price)} ₽</td>
                        <td className="px-4 py-4 font-bold">{formatMoney(foodCost?.food_cost ?? null)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${foodCostTone(foodCost?.food_cost_percent ?? null)}`}>
                            {formatPercent(foodCost?.food_cost_percent ?? null)}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-bold">{formatMoney(foodCost?.gross_profit ?? null)}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                              product.is_active
                                ? "bg-karimoff-orange/10 text-karimoff-orange"
                                : "bg-karimoff-black/5 text-karimoff-muted"
                            }`}
                          >
                            {product.is_active ? "Активен" : "Скрыт"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/admin/products/${product.id}/edit`}
                              className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange"
                            >
                              Редактировать
                            </Link>
                            <form action={toggleProductActiveAction}>
                              <input type="hidden" name="id" value={product.id} />
                              <input type="hidden" name="next_active" value={String(!product.is_active)} />
                              <button
                                type="submit"
                                className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange"
                              >
                                {product.is_active ? "Скрыть" : "Показать"}
                              </button>
                            </form>
                            <form action={deleteProductAction}>
                              <input type="hidden" name="id" value={product.id} />
                              <ConfirmSubmitButton
                                message={`Удалить товар «${product.name}»?`}
                                className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                              >
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
