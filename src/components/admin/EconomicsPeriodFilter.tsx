"use client";

import { useState } from "react";
import { RussianDateRangePicker } from "./RussianDateRangePicker";

type PeriodOption = readonly [string, string];

type Props = {
  initialFrom: string;
  initialPeriod: string;
  initialTo: string;
  options: readonly PeriodOption[];
};

export function EconomicsPeriodFilter({ initialFrom, initialPeriod, initialTo, options }: Props) {
  const [period, setPeriod] = useState(initialPeriod);
  return (
    <>
      <label className="admin-field economics-period-select">
        Период
        <select name="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="economics-date-range">
        {period === "custom" ? (
          <RussianDateRangePicker from={initialFrom} fromName="from" to={initialTo} toName="to" />
        ) : (
          <div className="economics-date-range-note">Выберите «Свой период», чтобы задать даты вручную.</div>
        )}
      </div>
    </>
  );
}
