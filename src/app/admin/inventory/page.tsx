import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { formatRub } from "@/lib/format";
import { formatInventoryQuantity, getInventoryCards } from "@/lib/inventory";
import { logoutAction } from "../login/actions";
import {
  correctInventoryAction,
  createInventoryItemAction,
  receiptInventoryAction,
  writeOffInventoryAction
} from "./actions";

type AdminInventoryPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }>;
};

const statusLabels = {
  empty: "Нет остатка",
  low: "Низкий остаток",
  missing: "Нет карточки",
  normal: "Норм"
};

const writeOffReasons = ["Порча", "Истёк срок годности", "Брак", "Тестовая готовка", "Инвентаризация", "Другое"];

export const dynamic = "force-dynamic";

function getStatusClass(status: keyof typeof statusLabels) {
  if (status === "normal") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "low") {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

function getMessage(params: Awaited<NonNullable<AdminInventoryPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Склад обновлён." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
  }

  return null;
}

export default async function AdminInventoryPage({ searchParams }: AdminInventoryPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { cards, movementsToday, notConfigured, error } = await getInventoryCards();
  const inventoryCount = cards.filter((card) => card.item).length;
  const lowCount = cards.filter((card) => card.status === "low" || card.status === "empty").length;
  const stockValue = cards.reduce((sum, card) => sum + card.stock_value, 0);

  return (
    <main className="admin-page">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Склад</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/inventory/movements" className="rounded-full border border-karimoff-line bg-white px-5 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              Движения
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
                Выйти
              </button>
            </form>
          </div>
        </header>

        {message ? (
          <div className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${message.tone === "success" ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange" : "border-red-200 bg-red-50 text-red-700"}`}>
            {message.text}
          </div>
        ) : null}

        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">
            Supabase не подключён. Заполните переменные окружения.
          </div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">{error}</div>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Ингредиентов на складе" value={String(inventoryCount)} />
              <StatCard label="Низкие остатки" value={String(lowCount)} tone={lowCount ? "warning" : "normal"} />
              <StatCard label="Стоимость остатков" value={formatRub(stockValue, 2)} />
              <StatCard label="Движений сегодня" value={String(movementsToday)} />
            </section>

            <section className="mt-6 grid gap-4 lg:grid-cols-3">
              <InventoryOperationForm
                id="receipt"
                action={receiptInventoryAction}
                cards={cards}
                title="Приход"
                description="Приход — добавление сырья на склад после закупки."
                submitLabel="Добавить приход"
                fields={
                  <>
                    <NumberField name="quantity" label="Количество" />
                    <NumberField name="package_price" label="Сумма закупки, ₽" required={false} step="0.01" />
                    <label className="flex items-center gap-3 rounded-lg border border-karimoff-line bg-white px-4 py-3 text-sm font-semibold">
                      <input name="update_cost_per_unit" type="checkbox" className="h-5 w-5 accent-karimoff-orange" />
                      Обновить себестоимость по закупке
                    </label>
                  </>
                }
              />
              <InventoryOperationForm
                id="write-off"
                action={writeOffInventoryAction}
                cards={cards}
                title="Списание"
                description="Списание — ручное уменьшение остатков из-за порчи, брака или инвентаризации."
                submitLabel="Списать"
                fields={
                  <>
                    <NumberField name="quantity" label="Количество" />
                    <label className="grid gap-2 text-sm font-semibold">
                      Причина
                      <select name="reason" className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange">
                        {writeOffReasons.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                }
              />
              <InventoryOperationForm
                id="correction"
                action={correctInventoryAction}
                cards={cards}
                title="Корректировка"
                description="Корректировка — фактический остаток после инвентаризации."
                submitLabel="Сохранить остаток"
                fields={<NumberField name="new_quantity" label="Новый остаток" />}
              />
            </section>

            <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
              <div className="border-b border-karimoff-line p-5">
                <p className="text-sm font-semibold text-karimoff-orange">Остатки</p>
                <h2 className="mt-2 text-3xl font-black">Складские карточки ингредиентов</h2>
              </div>
              {cards.length === 0 ? (
                <div className="p-8 text-karimoff-muted">Ингредиентов пока нет.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="admin-table min-w-[1180px]">
                    <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                      <tr>
                        <th className="px-4 py-4 font-bold">Ингредиент</th>
                        <th className="px-4 py-4 font-bold">Категория</th>
                        <th className="px-4 py-4 font-bold">Текущий остаток</th>
                        <th className="px-4 py-4 font-bold">Минимум</th>
                        <th className="px-4 py-4 font-bold">Статус</th>
                        <th className="px-4 py-4 font-bold">Себестоимость</th>
                        <th className="px-4 py-4 font-bold">Стоимость остатка</th>
                        <th className="px-4 py-4 font-bold">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map((card) => (
                        <tr key={card.ingredient.id} className="border-b border-karimoff-line last:border-b-0">
                          <td className="px-4 py-4">
                            <p className="font-semibold">{card.ingredient.name}</p>
                            <p className="mt-1 text-xs text-karimoff-muted">{card.item?.location ?? "Локация не задана"}</p>
                          </td>
                          <td className="px-4 py-4">{card.ingredient.category ?? "—"}</td>
                          <td className="px-4 py-4 font-black text-karimoff-black">
                            {card.item ? formatInventoryQuantity(card.item.current_quantity, card.item.unit) : "—"}
                          </td>
                          <td className="px-4 py-4 text-karimoff-muted">
                            {card.item ? formatInventoryQuantity(card.item.min_quantity, card.item.unit) : "—"}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${getStatusClass(card.status)}`}>
                              {statusLabels[card.status]}
                            </span>
                          </td>
                          <td className="px-4 py-4">{formatRub(card.ingredient.cost_per_unit, 4)} / {card.ingredient.unit}</td>
                          <td className="px-4 py-4 font-black text-karimoff-orange">{formatRub(card.stock_value, 2)}</td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              {card.item ? (
                                <>
                                  <a href="#receipt" className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">Приход</a>
                                  <a href="#write-off" className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">Списание</a>
                                  <a href="#correction" className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">Корректировка</a>
                                </>
                              ) : (
                                <form action={createInventoryItemAction}>
                                  <input type="hidden" name="ingredient_id" value={card.ingredient.id} />
                                  <input type="hidden" name="return_to" value="/admin/inventory" />
                                  <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2 text-xs font-bold text-white transition hover:bg-[#D95405]">
                                    Создать карточку
                                  </button>
                                </form>
                              )}
                              <Link href={`/admin/inventory/movements?ingredient_id=${card.ingredient.id}`} className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                                История
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warning" }) {
  return (
    <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
      <p className="text-sm font-semibold text-karimoff-muted">{label}</p>
      <p className={`mt-2 text-3xl font-black ${tone === "warning" ? "text-amber-700" : "text-karimoff-orange"}`}>{value}</p>
    </div>
  );
}

function NumberField({
  label,
  name,
  required = true,
  step = "0.001"
}: {
  label: string;
  name: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input
        name={name}
        required={required}
        type="number"
        min="0"
        step={step}
        className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange"
      />
    </label>
  );
}

function InventoryOperationForm({
  action,
  cards,
  description,
  fields,
  id,
  submitLabel,
  title
}: {
  action: (formData: FormData) => void | Promise<void>;
  cards: Awaited<ReturnType<typeof getInventoryCards>>["cards"];
  description: string;
  fields: ReactNode;
  id: string;
  submitLabel: string;
  title: string;
}) {
  const availableCards = cards.filter((card) => card.item);

  return (
    <form id={id} action={action} className="grid gap-4 rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
      <div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-karimoff-muted">{description}</p>
      </div>
      <label className="grid gap-2 text-sm font-semibold">
        Ингредиент
        <select name="ingredient_id" required className="rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange">
          <option value="">Выберите ингредиент</option>
          {availableCards.map((card) => (
            <option key={card.ingredient.id} value={card.ingredient.id}>
              {card.ingredient.name} ({formatInventoryQuantity(card.item?.current_quantity ?? 0, card.item?.unit ?? card.ingredient.unit)})
            </option>
          ))}
        </select>
      </label>
      {fields}
      <label className="grid gap-2 text-sm font-semibold">
        Комментарий
        <textarea name="comment" rows={3} className="resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 outline-none focus:border-karimoff-orange" />
      </label>
      <button type="submit" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405]">
        {submitLabel}
      </button>
    </form>
  );
}
