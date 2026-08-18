"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { saveEconomicsSettingsAction } from "@/app/admin/economics/actions";
import {
  economicsValuesToDrafts,
  formatEconomicsDraft,
  initialEconomicsSaveState,
  parseEconomicsNumber
} from "@/lib/economics-input";
import { economicsKeys, type EconomicsValues } from "@/lib/economics-values";
import { formatNumber, formatRub } from "@/lib/format";

type EconomicsCalculatorProps = {
  initialValues: EconomicsValues;
};

const groups: Array<{
  title: string;
  description: string;
  items: Array<{ key: keyof EconomicsValues; label: string; suffix?: string }>;
}> = [
  {
    title: "Выручка",
    description: "Средние операционные показатели одной точки.",
    items: [
      { key: "average_check", label: "Средний чек", suffix: "₽" },
      { key: "orders_per_day", label: "Заказов в день", suffix: "шт." },
      { key: "working_days_per_month", label: "Рабочих дней в месяц", suffix: "дн." }
    ]
  },
  {
    title: "Себестоимость",
    description: "Доля продуктов в выручке без учёта постоянных расходов.",
    items: [{ key: "food_cost_percent", label: "Себестоимость продуктов", suffix: "%" }]
  },
  {
    title: "OPEX",
    description: "Регулярные ежемесячные расходы точки.",
    items: [
      { key: "rent", label: "Аренда", suffix: "₽" },
      { key: "payroll", label: "ФОТ", suffix: "₽" },
      { key: "utilities", label: "Коммунальные", suffix: "₽" },
      { key: "marketing", label: "Маркетинг", suffix: "₽" },
      { key: "other_expenses", label: "Прочие расходы", suffix: "₽" }
    ]
  },
  {
    title: "CAPEX",
    description: "Разовые вложения в запуск и оснащение.",
    items: [
      { key: "equipment", label: "Оборудование", suffix: "₽" },
      { key: "renovation", label: "Ремонт", suffix: "₽" },
      { key: "furniture", label: "Мебель", suffix: "₽" },
      { key: "launch_marketing", label: "Маркетинг запуска", suffix: "₽" },
      { key: "other_capex", label: "Прочий CAPEX", suffix: "₽" }
    ]
  },
  {
    title: "Франшиза и комиссии",
    description: "Процентные расходы, которые считаются от выручки.",
    items: [
      { key: "royalty_percent", label: "Роялти", suffix: "%" },
      { key: "acquiring_percent", label: "Эквайринг", suffix: "%" },
      { key: "tax_percent", label: "Налоги", suffix: "%" },
      { key: "misc_percent", label: "Прочие проценты", suffix: "%" }
    ]
  }
];

function formatMonths(value: number) {
  return `${formatNumber(value, 1)} мес.`;
}

export function EconomicsCalculator({ initialValues }: EconomicsCalculatorProps) {
  const [state, formAction, isPending] = useActionState(saveEconomicsSettingsAction, initialEconomicsSaveState);
  const [drafts, setDrafts] = useState(() => economicsValuesToDrafts(initialValues));
  const [editedFields, setEditedFields] = useState<Set<keyof EconomicsValues>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState<keyof EconomicsValues | null>(null);

  const values = useMemo(
    () => economicsKeys.reduce((accumulator, key) => {
      accumulator[key] = parseEconomicsNumber(drafts[key]) ?? 0;
      return accumulator;
    }, {} as EconomicsValues),
    [drafts]
  );

  const results = useMemo(() => {
    const monthlyRevenue = values.average_check * values.orders_per_day * values.working_days_per_month;
    const cogs = (monthlyRevenue * values.food_cost_percent) / 100;
    const royalty = (monthlyRevenue * values.royalty_percent) / 100;
    const acquiring = (monthlyRevenue * values.acquiring_percent) / 100;
    const tax = (monthlyRevenue * values.tax_percent) / 100;
    const misc = (monthlyRevenue * values.misc_percent) / 100;
    const totalOpex = values.rent + values.payroll + values.utilities + values.marketing + values.other_expenses;
    const monthlyProfit = monthlyRevenue - cogs - totalOpex - royalty - acquiring - tax - misc;
    const totalCapex =
      values.equipment + values.renovation + values.furniture + values.launch_marketing + values.other_capex;
    const paybackMonths = monthlyProfit > 0 ? totalCapex / monthlyProfit : null;

    return {
      acquiring,
      cogs,
      misc,
      monthlyProfit,
      monthlyRevenue,
      paybackMonths,
      royalty,
      tax,
      totalCapex,
      totalOpex
    };
  }, [values]);

  const updateDraft = (key: keyof EconomicsValues, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    setEditedFields((current) => new Set(current).add(key));
  };

  const finishEditing = (key: keyof EconomicsValues) => {
    const parsed = parseEconomicsNumber(drafts[key]);
    if (parsed !== null) updateDraft(key, String(parsed));
    setFocusedKey((current) => current === key ? null : current);
  };

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={() => setEditedFields(new Set())}
      className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.72fr)]"
    >
      <section className="grid gap-5">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <h2 className="text-2xl font-black">{group.title}</h2>
            <p className="mt-1 text-sm leading-5 text-karimoff-muted">{group.description}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {group.items.map((item) => {
                const error = editedFields.has(item.key) ? undefined : state.fieldErrors?.[item.key];
                const errorId = `${item.key}-error`;
                return (
                  <label key={item.key} className="grid content-start gap-2 text-sm font-semibold text-karimoff-black">
                    <span>{item.label}</span>
                    <div
                      className={`flex min-h-[48px] overflow-hidden rounded-lg border bg-white transition focus-within:border-karimoff-orange focus-within:shadow-[0_0_0_3px_rgba(251,103,10,0.09)] ${error ? "border-red-300" : "border-karimoff-line"}`}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        name={item.key}
                        value={focusedKey === item.key ? drafts[item.key] : formatEconomicsDraft(drafts[item.key])}
                        onFocus={() => setFocusedKey(item.key)}
                        onBlur={() => finishEditing(item.key)}
                        onChange={(event) => updateDraft(item.key, event.target.value)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                        className="min-w-0 flex-1 bg-transparent px-4 py-3 text-base font-bold tabular-nums outline-none sm:text-sm"
                      />
                      {item.suffix ? (
                        <span className="flex min-w-12 items-center justify-center border-l border-karimoff-line bg-karimoff-soft px-3 text-sm font-bold text-karimoff-muted">
                          {item.suffix}
                        </span>
                      ) : null}
                    </div>
                    {error ? <span id={errorId} className="text-xs font-semibold text-red-600">{error}</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex flex-col items-start gap-3 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={isPending}
            className="min-h-12 rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange disabled:cursor-not-allowed disabled:opacity-65"
          >
            {isPending ? "Сохраняем" : "Сохранить вводные"}
          </button>
          {state.message && !isPending && editedFields.size === 0 ? (
            <p
              role={state.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`inline-flex items-center gap-2 text-sm font-semibold ${state.status === "success" ? "text-emerald-700" : "text-red-600"}`}
            >
              {state.status === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
              <span>{state.message}</span>
            </p>
          ) : null}
        </div>
      </section>

      <aside className="h-fit rounded-lg border border-karimoff-line bg-white p-5 shadow-card lg:sticky lg:top-8">
        <p className="text-sm font-semibold text-karimoff-orange">Результаты</p>
        <h2 className="mt-2 text-2xl font-black leading-tight">Расчёт точки</h2>
        <div className="mt-6 grid gap-3">
          <ResultLine label="Месячная выручка" value={formatRub(results.monthlyRevenue)} strong />
          <ResultLine label="Себестоимость" value={formatRub(results.cogs)} />
          <ResultLine label="OPEX" value={formatRub(results.totalOpex)} />
          <ResultLine label="Роялти" value={formatRub(results.royalty)} />
          <ResultLine label="Эквайринг" value={formatRub(results.acquiring)} />
          <ResultLine label="Налоги" value={formatRub(results.tax)} />
          <ResultLine label="Прочие проценты" value={formatRub(results.misc)} />
          <ResultLine label="Прибыль в месяц" value={formatRub(results.monthlyProfit)} strong />
          <ResultLine label="CAPEX" value={formatRub(results.totalCapex)} />
        </div>
        <div className="mt-5 rounded-lg bg-karimoff-orange/10 p-4">
          <p className="text-sm font-semibold text-karimoff-muted">Расчётная окупаемость</p>
          <p className="mt-1 text-2xl font-black text-karimoff-orange">
            {results.paybackMonths ? formatMonths(results.paybackMonths) : "Не окупается при текущих вводных"}
          </p>
        </div>
        <p className="mt-5 text-xs leading-5 text-karimoff-muted">
          Расчёт демонстрационный, не является гарантией окупаемости.
        </p>
      </aside>
    </form>
  );
}

function ResultLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-karimoff-line pb-3 last:border-b-0">
      <span className="text-sm text-karimoff-muted">{label}</span>
      <span className={strong ? "text-lg font-black text-karimoff-black" : "text-sm font-bold text-karimoff-black"}>
        {value}
      </span>
    </div>
  );
}
