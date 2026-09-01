"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ActualManagementResult } from "@/lib/economics-actual";
import type { EconomicsValues } from "@/lib/economics-values";
import { formatNumber, formatPercent, formatRub } from "@/lib/format";
import {
  calculateManagementResult,
  createManagementExpenseDefaults,
  type ManagementExpenseInputs
} from "@/lib/management-result";

type Props = {
  actual: ActualManagementResult;
  calendarDays: number;
  initialValues: EconomicsValues;
  rangeLabel: string;
};

const fixedFields: Array<{ key: keyof ManagementExpenseInputs; label: string }> = [
  { key: "rent", label: "Аренда" },
  { key: "payroll", label: "ФОТ" },
  { key: "utilities", label: "Коммунальные" },
  { key: "marketing", label: "Маркетинг" },
  { key: "other", label: "Прочие расходы" },
  { key: "capex", label: "CAPEX за период" }
];

const percentFields: Array<{ key: keyof ManagementExpenseInputs; label: string }> = [
  { key: "acquiringPosPercent", label: "Эквайринг кассы" },
  { key: "acquiringWebPercent", label: "Эквайринг сайта" },
  { key: "taxPercent", label: "Налоги" },
  { key: "royaltyPercent", label: "Роялти" },
  { key: "miscPercent", label: "Прочие комиссии" }
];

export function ActualManagementResultCalculator({ actual, calendarDays, initialValues, rangeLabel }: Props) {
  const defaults = useMemo(() => createManagementExpenseDefaults(initialValues, calendarDays), [calendarDays, initialValues]);
  const [drafts, setDrafts] = useState(defaults);
  const result = useMemo(() => calculateManagementResult(actual, drafts), [actual, drafts]);

  const update = (key: keyof ManagementExpenseInputs, value: string) => {
    const parsed = Number(value.replace(",", "."));
    setDrafts((current) => ({ ...current, [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }));
  };

  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-card">
      <header className="border-b border-karimoff-line p-5 sm:p-6">
        <p className="admin-eyebrow">Фактические продажи · {rangeLabel}</p>
        <h2 className="mt-2 text-3xl font-black">Управленческий результат</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-karimoff-muted">
          Выручка и food cost загружены из аналитики. Расходы ниже относятся только к выбранному периоду и не меняют бухгалтерские данные.
        </p>
      </header>

      <div className="grid gap-px bg-karimoff-line sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Выручка" value={formatRub(actual.revenue, 2)} hint={`${formatNumber(actual.sales)} продаж`} />
        <Metric label="Food cost" value={formatRub(actual.foodCost, 2)} hint={`покрытие ${formatPercent(actual.foodCostCoveragePercent)}`} />
        <Metric label="Валовая прибыль по food cost" value={formatRub(actual.grossProfit, 2)} hint="по продажам с полной техкартой" />
        <Metric label="Операционный результат" value={formatRub(result.operatingResult, 2)} hint="до CAPEX и неучтённых расходов" accent />
      </div>

      {actual.foodCostCoveragePercent < 99.99 ? (
        <div className="m-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 sm:m-6">
          <AlertTriangle className="mt-0.5 shrink-0" size={19} />
          <span>
            Food cost рассчитан для {formatPercent(actual.foodCostCoveragePercent)} выручки. Продажи на {formatRub(actual.uncoveredRevenue, 2)} не включены в валовую прибыль и операционный результат, поэтому итог пока предварительный.
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <div className="grid gap-6">
          <section>
            <div className="flex items-center justify-between gap-4">
              <div><h3 className="text-xl font-black">Расходы за период</h3><p className="mt-1 text-sm text-karimoff-muted">Начальные суммы пропорциональны {calendarDays} календарным дням.</p></div>
              <button type="button" onClick={() => setDrafts(defaults)} className="admin-secondary-button"><RotateCcw size={16} />Сбросить</button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {fixedFields.map((field) => <MoneyInput key={field.key} label={field.label} value={drafts[field.key]} onChange={(value) => update(field.key, value)} />)}
            </div>
          </section>
          <section>
            <h3 className="text-xl font-black">Налоги и комиссии</h3>
            <p className="mt-1 text-sm text-karimoff-muted">Сайт и касса считаются раздельно. Роялти для основной точки по умолчанию 0%.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {percentFields.map((field) => <PercentInput key={field.key} label={field.label} value={drafts[field.key]} onChange={(value) => update(field.key, value)} />)}
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-lg border border-karimoff-line bg-karimoff-soft p-5">
          <p className="admin-eyebrow">Расчёт</p>
          <h3 className="mt-2 text-2xl font-black">От выручки до результата</h3>
          <div className="mt-5 grid gap-3">
            <ResultLine label="Покрытая выручка" value={actual.coveredRevenue} strong />
            <ResultLine label="Касса / Evotor" value={actual.posCoveredRevenue} />
            <ResultLine label="Сайт" value={actual.webCoveredRevenue} />
            {actual.otherCoveredRevenue > 0 ? <ResultLine label="Другие каналы" value={actual.otherCoveredRevenue} /> : null}
            <ResultLine label="Food cost" value={-actual.foodCost} />
            <ResultLine label="Валовая прибыль" value={actual.grossProfit} strong />
            <ResultLine label="Постоянные расходы" value={-result.fixedOpex} />
            <ResultLine label="Налоги и комиссии" value={-result.commissions} />
            <ResultLine label="Операционный результат" value={result.operatingResult} strong />
            <ResultLine label="CAPEX" value={-drafts.capex} />
            <ResultLine label="Денежный результат" value={result.cashResult} strong accent />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return <article className="bg-white p-5 sm:p-6"><p className="text-xs font-bold uppercase text-karimoff-muted">{label}</p><strong className={`mt-2 block text-2xl font-black ${accent ? "text-karimoff-orange" : "text-karimoff-black"}`}>{value}</strong><span className="mt-1 block text-xs text-karimoff-muted">{hint}</span></article>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label className="admin-field">{label}<div className="flex overflow-hidden rounded-lg border border-karimoff-line bg-white focus-within:border-karimoff-orange"><input type="number" min="0" step="100" value={value} onChange={(event) => onChange(event.target.value)} /><span className="flex items-center border-l border-karimoff-line px-3 font-bold text-karimoff-muted">₽</span></div></label>;
}

function PercentInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label className="admin-field">{label}<div className="flex overflow-hidden rounded-lg border border-karimoff-line bg-white focus-within:border-karimoff-orange"><input type="number" min="0" max="100" step="0.1" value={value} onChange={(event) => onChange(event.target.value)} /><span className="flex items-center border-l border-karimoff-line px-3 font-bold text-karimoff-muted">%</span></div></label>;
}

function ResultLine({ label, value, strong = false, accent = false }: { label: string; value: number; strong?: boolean; accent?: boolean }) {
  const tone = accent ? "text-karimoff-orange" : value < 0 ? "text-red-600" : "text-karimoff-black";
  return <div className="flex items-center justify-between gap-4 border-b border-karimoff-line pb-3 last:border-0"><span className="text-sm text-karimoff-muted">{label}</span><span className={`${strong ? "text-base font-black" : "text-sm font-bold"} ${tone}`}>{formatRub(value, 2)}</span></div>;
}
