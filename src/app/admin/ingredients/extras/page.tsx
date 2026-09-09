import Link from "next/link";
import { redirect } from "next/navigation";
import { Save } from "lucide-react";
import { getCurrentStaff } from "@/lib/admin-auth";
import { listExtrasCatalog } from "@/lib/extras-service";
import { installExtrasAction, updateExtraPriceAction } from "./actions";

export const dynamic = "force-dynamic";
const rub = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value);
export default async function ExtrasPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin"].includes(staff.role)) redirect("/admin/login");
  const params = await searchParams;
  const extras = await listExtrasCatalog();
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><Link href="/admin/ingredients" className="text-sm font-semibold text-karimoff-muted">Ингредиенты</Link><h1 className="mt-2 text-3xl font-black">Допы к блюдам</h1></div>
      <form action={installExtrasAction}><button className="min-h-11 rounded-md bg-karimoff-black px-5 py-3 text-sm font-bold text-white hover:bg-black/80" type="submit">{extras.length ? "Добавить к новым блюдам" : "Добавить допы в каталог"}</button></form>
    </header>
    {params.saved ? <p className="admin-alert admin-alert-success">Допы сохранены.</p> : null}
    {params.error ? <p className="admin-alert admin-alert-error">{params.error}</p> : null}
    {!extras.length ? <p className="admin-empty">Допы ещё не добавлены. Каталог общий для сайта и стенда.</p> : null}
    <section className="divide-y divide-black/10">
      {extras.map(extra => {
        const cost = Number(extra.cost) > 0 ? Number(extra.cost) * Number(extra.quantity) / (1 - Number(extra.waste) / 100) : null;
        return <article key={`${extra.ingredient_id}:${extra.label}`} className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_240px]">
          <div><h2 className="text-base font-bold">{extra.label}</h2>
            <p className="mt-1 text-sm text-karimoff-muted">{extra.product_count} блюд · Себестоимость: {cost === null ? "Данные уточняются" : rub(cost)}{cost === null ? "" : ` · Food cost: ${(cost / Number(extra.price) * 100).toFixed(1)}%`}</p>
            {extra.note ? <p className="mt-2 text-sm text-amber-800">{extra.note}</p> : null}
            <Link href={`/admin/ingredients/${extra.ingredient_id}/edit`} className="mt-2 inline-block text-sm underline">Закупочная стоимость ингредиента</Link>
            {extra.price !== extra.price_max ? <p className="text-sm text-amber-800">У блюд разные цены. Сохранение установит единую цену.</p> : null}
          </div>
          <form action={updateExtraPriceAction} className="flex items-end gap-2">
            <input type="hidden" name="ingredient_id" value={extra.ingredient_id} /><input type="hidden" name="label" value={extra.label} />
            <label className="min-w-0 flex-1 text-sm font-medium">Цена для гостя, ₽<input name="price" required inputMode="decimal" defaultValue={extra.price} className="mt-1 min-h-11 w-full rounded-md border border-black/20 bg-white px-3 text-base" /></label>
            <button type="submit" title="Сохранить цену для всех блюд" aria-label={`Сохранить цену: ${extra.label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-karimoff-black text-white hover:bg-black/80"><Save size={20} /></button>
          </form>
        </article>;
      })}
    </section>
  </main>;
}
