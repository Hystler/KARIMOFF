"use client";

import { Clock3 } from "lucide-react";
import { formatOrderSlot } from "@/lib/order-time";

type ScheduledTimeSliderProps = {
  slots: number[];
  value: number;
  onChange: (value: number) => void;
};

export function ScheduledTimeSlider({ slots, value, onChange }: ScheduledTimeSliderProps) {
  if (!slots.length) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">
        На сегодня свободных интервалов уже нет. Выберите «Как можно скорее».
      </div>
    );
  }

  const safeValue = Math.min(value, slots.length - 1);
  const progress = slots.length === 1 ? 100 : (safeValue / (slots.length - 1)) * 100;
  const selectedTime = formatOrderSlot(slots[safeValue]);

  return (
    <div className="mt-4 rounded-lg border border-karimoff-orange/20 bg-karimoff-cream p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-karimoff-muted">Сегодня, ко времени</p>
          <p className="mt-1 text-xs leading-5 text-karimoff-muted">Шаг 15 минут</p>
        </div>
        <output className="inline-flex min-h-11 items-center gap-2 rounded-full bg-karimoff-black px-4 text-base font-black tabular-nums text-white shadow-[0_10px_24px_rgba(18,18,20,0.16)]">
          <Clock3 size={17} className="text-karimoff-orange" />
          {selectedTime}
        </output>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, slots.length - 1)}
        step={1}
        value={safeValue}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Время получения заказа сегодня"
        className="order-time-slider mt-5 w-full"
        style={{ backgroundSize: `${progress}% 100%` }}
      />
      <div className="mt-2 flex justify-between text-xs font-semibold tabular-nums text-karimoff-muted">
        <span>{formatOrderSlot(slots[0])}</span>
        <span>{formatOrderSlot(slots.at(-1) ?? slots[0])}</span>
      </div>
    </div>
  );
}
