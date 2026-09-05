"use client";

import { CalendarRange, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  from: string;
  fromName?: string;
  onApply?: (from: string, to: string) => void;
  to: string;
  toName?: string;
};

const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const rangeFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1, 12);
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1, 12);
}

function calendarDays(month: Date) {
  const first = startOfMonth(month);
  const firstWeekday = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - firstWeekday, 12);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function formatRange(from: string, to: string) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  if (!fromDate || !toDate) return "Выбрать даты";
  return `${rangeFormatter.format(fromDate)} — ${rangeFormatter.format(toDate)}`;
}

export function RussianDateRangePicker({ from, fromName, onApply, to, toName }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedFrom, setSelectedFrom] = useState(from);
  const [selectedTo, setSelectedTo] = useState(to);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseDateKey(from) ?? new Date()));
  const rootRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(viewMonth), [viewMonth]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (next: string) => {
    if (!draftFrom || draftTo) {
      setDraftFrom(next);
      setDraftTo("");
      return;
    }
    if (next < draftFrom) {
      setDraftFrom(next);
      setDraftTo(draftFrom);
      return;
    }
    setDraftTo(next);
  };

  const apply = () => {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    setSelectedFrom(draftFrom);
    setSelectedTo(draftTo);
    onApply?.(draftFrom, draftTo);
    setOpen(false);
  };

  const toggle = () => {
    if (!open) {
      setDraftFrom(selectedFrom);
      setDraftTo(selectedTo);
      setViewMonth(startOfMonth(parseDateKey(selectedFrom) ?? new Date()));
    }
    setOpen((current) => !current);
  };

  return (
    <div className="russian-date-range" ref={rootRef}>
      {fromName ? <input type="hidden" name={fromName} value={selectedFrom} readOnly /> : null}
      {toName ? <input type="hidden" name={toName} value={selectedTo} readOnly /> : null}
      <button
        type="button"
        className="russian-date-range-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <CalendarRange size={18} />
        <span><small>Период</small><strong>{formatRange(selectedFrom, selectedTo)}</strong></span>
      </button>

      {open ? (
        <div className="russian-date-range-popover" role="dialog" aria-label="Выбор периода">
          <header>
            <div><span>Выберите период</span><strong>{formatRange(draftFrom, draftTo)}</strong></div>
            <button type="button" aria-label="Закрыть календарь" onClick={() => setOpen(false)}><X size={18} /></button>
          </header>
          <div className="russian-date-range-month-nav">
            <button type="button" aria-label="Предыдущий месяц" onClick={() => setViewMonth((current) => addMonths(current, -1))}><ChevronLeft size={19} /></button>
            <strong>{monthFormatter.format(viewMonth)}</strong>
            <button type="button" aria-label="Следующий месяц" onClick={() => setViewMonth((current) => addMonths(current, 1))}><ChevronRight size={19} /></button>
          </div>
          <div className="russian-date-range-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="russian-date-range-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const selected = key === draftFrom || key === draftTo;
              const inRange = Boolean(draftFrom && draftTo && key > draftFrom && key < draftTo);
              return (
                <button
                  type="button"
                  key={key}
                  aria-label={rangeFormatter.format(day)}
                  aria-pressed={selected}
                  className={`${day.getMonth() === viewMonth.getMonth() ? "" : "is-outside"} ${selected ? "is-selected" : ""} ${inRange ? "is-in-range" : ""}`}
                  onClick={() => choose(key)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <footer>
            <span>{draftFrom && !draftTo ? "Теперь выберите последний день" : "Даты включаются в отчёт полностью"}</span>
            <button type="button" onClick={apply} disabled={!draftFrom || !draftTo || draftFrom > draftTo}><Check size={17} />Применить</button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
