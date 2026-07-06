import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { formatInventoryQuantity, getInventoryMovements, type InventoryMovementType } from "@/lib/inventory";
import { logoutAction } from "../../login/actions";

type MovementsPageProps = {
  searchParams?: Promise<{
    ingredient_id?: string;
    movement_type?: string;
  }>;
};

const movementLabels: Record<InventoryMovementType, string> = {
  correction: "Корректировка",
  receipt: "Приход",
  return: "Возврат",
  sale: "Автосписание",
  write_off: "Списание"
};

export const dynamic = "force-dynamic";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(date));
}

function movementTone(type: InventoryMovementType) {
  if (type === "receipt" || type === "return") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (type === "write_off" || type === "sale") {
    return "bg-red-50 text-red-700";
  }

  return "bg-amber-50 text-amber-700";
}

export default async function InventoryMovementsPage({ searchParams }: MovementsPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const { ingredients, movements, notConfigured, error } = await getInventoryMovements({
    ingredientId: params.ingredient_id,
    movementType: params.movement_type
  });

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin/inventory" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Склад
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Движения склада</h1>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              Выйти
            </button>
          </form>
        </header>

        <form className="mt-8 grid gap-4 rounded-[1.25rem] border border-karimoff-line bg-white p-5 shadow-card md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="grid gap-2 text-sm font-semibold">
            Ингредиент
            <select name="ingredient_id" defaultValue={params.ingredient_id ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange">
              <option value="">Все ингредиенты</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Тип движения
            <select name="movement_type" defaultValue={params.movement_type ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange">
              <option value="">Все типы</option>
              {Object.entries(movementLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)] transition hover:bg-[#D95405]">
            Показать
          </button>
        </form>

        <section className="mt-8 rounded-[1.25rem] border border-karimoff-line bg-white shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : movements.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Движений пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Дата</th>
                    <th className="px-4 py-4 font-bold">Ингредиент</th>
                    <th className="px-4 py-4 font-bold">Тип</th>
                    <th className="px-4 py-4 font-bold">Количество</th>
                    <th className="px-4 py-4 font-bold">Причина</th>
                    <th className="px-4 py-4 font-bold">Заказ</th>
                    <th className="px-4 py-4 font-bold">Комментарий</th>
                    <th className="px-4 py-4 font-bold">Кем</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id} className="border-b border-karimoff-line last:border-b-0">
                      <td className="px-4 py-4 text-karimoff-muted">{formatDate(movement.created_at)}</td>
                      <td className="px-4 py-4 font-semibold">{movement.ingredient_name ?? "Ингредиент удалён"}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${movementTone(movement.movement_type)}`}>
                          {movementLabels[movement.movement_type] ?? movement.movement_type}
                        </span>
                      </td>
                      <td className={`px-4 py-4 font-black ${movement.quantity < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {formatInventoryQuantity(movement.quantity, movement.unit)}
                      </td>
                      <td className="px-4 py-4 text-karimoff-muted">{movement.reason ?? "—"}</td>
                      <td className="px-4 py-4 text-xs text-karimoff-muted">{movement.order_id ?? "—"}</td>
                      <td className="max-w-[260px] px-4 py-4 text-karimoff-muted">{movement.comment ?? "—"}</td>
                      <td className="px-4 py-4 text-karimoff-muted">{movement.created_by}</td>
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
