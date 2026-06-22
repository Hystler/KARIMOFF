import Link from "next/link";
import { redirect } from "next/navigation";
import { EconomicsCalculator } from "@/components/admin/EconomicsCalculator";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminEconomicsSettings } from "@/lib/economics";
import { formatPercent, formatRub } from "@/lib/format";
import { getProductsFoodCosts } from "@/lib/ingredients";
import { getAdminProducts } from "@/lib/products";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

function foodCostTone(value: number | null) {
  if (value === null) {
    return "bg-karimoff-black/5 text-karimoff-muted";
  }

  if (value < 30) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (value < 40) {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

export default async function AdminEconomicsPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const productsResult = await getAdminProducts();
  const economicsResult = await getAdminEconomicsSettings();
  const productEconomics = productsResult.error
    ? {
        items: [],
        error: productsResult.error
      }
    : await getProductsFoodCosts(productsResult.products);

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Юнит-экономика</h1>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
        </header>

        {economicsResult.error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {economicsResult.error}
          </div>
        ) : null}

        <EconomicsCalculator initialValues={economicsResult.settings} />

        <section className="mt-8 rounded-[1.25rem] border border-karimoff-line bg-white shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
          <div className="border-b border-karimoff-line p-5">
            <p className="text-sm font-semibold text-karimoff-orange">Food cost</p>
            <h2 className="mt-2 text-3xl font-black">Юнит-экономика товаров</h2>
          </div>
          {productEconomics.error ? (
            <div className="p-6 text-sm font-semibold text-red-600">{productEconomics.error}</div>
          ) : productEconomics.items.length === 0 ? (
            <div className="p-6 text-sm text-karimoff-muted">Товары пока не загружены.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Товар</th>
                    <th className="px-4 py-4 font-bold">Цена</th>
                    <th className="px-4 py-4 font-bold">Food cost</th>
                    <th className="px-4 py-4 font-bold">Food cost %</th>
                    <th className="px-4 py-4 font-bold">Gross profit</th>
                    <th className="px-4 py-4 font-bold">Gross margin</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {productEconomics.items.map((item) => (
                    <tr key={item.product.id} className="border-b border-karimoff-line last:border-b-0">
                      <td className="px-4 py-4">
                        <p className="font-bold text-karimoff-black">{item.product.name}</p>
                        <p className="mt-1 text-xs text-karimoff-muted">{item.product.category}</p>
                      </td>
                      <td className="px-4 py-4 font-black text-karimoff-orange">{formatRub(item.product.price)}</td>
                      <td className="px-4 py-4">{formatRub(item.food_cost, 2)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${foodCostTone(item.food_cost_percent)}`}>
                          {formatPercent(item.food_cost_percent)}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-bold">{formatRub(item.gross_profit, 2)}</td>
                      <td className="px-4 py-4">{formatPercent(item.gross_margin_percent)}</td>
                      <td className="px-4 py-4 text-xs font-semibold text-karimoff-muted">
                        {item.food_cost === null ? "Нужно добавить состав товара" : item.food_cost_percent && item.food_cost_percent >= 40 ? "Критично" : item.food_cost_percent && item.food_cost_percent >= 30 ? "Внимание" : "Норм"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
