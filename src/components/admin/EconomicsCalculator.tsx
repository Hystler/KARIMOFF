"use client";

import { useActionState, useMemo, useState } from "react";
import {
  initialEconomicsSaveState,
  saveEconomicsSettingsAction
} from "@/app/admin/economics/actions";
import type { EconomicsValues } from "@/lib/economics";
import { formatNumber, formatRub } from "@/lib/format";

type EconomicsCalculatorProps = {
  initialValues: EconomicsValues;
};

const groups: Array<{
  title: string;
  items: Array<{ key: keyof EconomicsValues; label: string; suffix?: "%" | "₽" }>;
}> = [
  {
    title: "Выручка",
    items: [
      { key: "average_check", label: "Средний чек", suffix: "₽" },
      { key: "orders_per_day", label: "Заказов в день" },
      { key: "working_days_per_month", label: "Рабочих дней в месяц" }
    ]
  },
  {
    title: "Себестоимость",
    items: [{ key: "food_cost_percent", label: "Food cost", suffix: "%" }]
  },
  {
    title: "OPEX",
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
  const [values, setValues] = useState<EconomicsValues>(initialValues);

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

  return (
    <form action={formAction} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.72fr)]">
      <section className="grid gap-5">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <h2 className="text-2xl font-black">{group.title}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {group.items.map((item) => (
                <label key={item.key} className="grid gap-2 text-sm font-semibold text-karimoff-black">
                  {item.label}
                  <div className="flex overflow-hidden rounded-xl border border-karimoff-line bg-white focus-within:border-karimoff-orange">
                    <input
                      type="number"
                      step={item.suffix === "%" ? "0.1" : "1"}
                      min="0"
                      name={item.key}
                      value={values[item.key]}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [item.key]: Number(event.target.value)
                        }))
                      }
                      className="min-w-0 flex-1 px-4 py-3 text-sm outline-none"
                    />
                    {item.suffix ? (
                      <span className="flex items-center bg-karimoff-soft px-3 text-sm font-bold text-karimoff-muted">
                        {item.suffix}
                      </span>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] disabled:cursor-not-allowed disabled:opacity-65"
          >
            {isPending ? "Сохраняем" : "Сохранить вводные"}
          </button>
          {state.message ? (
            <p className={state.status === "success" ? "mt-3 text-sm font-semibold text-karimoff-orange" : "mt-3 text-sm font-semibold text-red-600"}>
              {state.message}
            </p>
          ) : null}
        </div>
      </section>

      <aside className="h-fit rounded-lg border border-karimoff-line bg-white p-5 shadow-card lg:sticky lg:top-8">
        <p className="text-sm font-semibold text-karimoff-orange">Результаты</p>
        <h2 className="mt-2 text-3xl font-black">Финмодель MVP</h2>
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
          <p className="text-sm font-semibold text-karimoff-muted">Payback</p>
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
