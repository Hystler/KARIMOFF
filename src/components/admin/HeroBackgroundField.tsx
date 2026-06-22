"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";

type HeroBackgroundFieldProps = {
  fieldKey: string;
  hint: string;
  title: string;
  value?: string | null;
};

const TARGET_WIDTH = 2400;
const TARGET_HEIGHT = 1200;
const TARGET_RATIO = TARGET_WIDTH / TARGET_HEIGHT;

function getDimensionWarning(width: number, height: number) {
  const ratio = width / height;
  const ratioDiff = Math.abs(ratio - TARGET_RATIO);

  if (width === TARGET_WIDTH && height === TARGET_HEIGHT) {
    return null;
  }

  if (ratioDiff > 0.08) {
    return "Фото отличается от рекомендованного формата 2400×1200 и пропорции 2:1. На сайте оно может заметно обрезаться.";
  }

  return "Фото отличается от рекомендованного размера 2400×1200 px. Загрузку не блокируем, но проверьте кадрирование на сайте.";
}

export function HeroBackgroundField({ fieldKey, hint, title, value }: HeroBackgroundFieldProps) {
  const [warning, setWarning] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setWarning(null);
    const file = event.target.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      setWarning(getDimensionWarning(image.naturalWidth, image.naturalHeight));
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      setWarning("Не удалось проверить размер изображения. Загрузку не блокируем.");
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  }

  return (
    <div className="grid gap-4 rounded-xl border border-karimoff-line bg-white p-4 lg:grid-cols-[240px_1fr]">
      <div className="overflow-hidden rounded-xl border border-karimoff-line bg-karimoff-soft">
        <div className="aspect-[2/1] w-full">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={`Фон: ${title}`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs font-semibold text-karimoff-muted">
              Фон не задан
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-3">
        <div>
          <h3 className="text-lg font-black">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-karimoff-muted">{hint}</p>
        </div>
        <label className="grid gap-2 text-sm font-semibold">
          Загрузить фото
          <input
            name={`${fieldKey}_file`}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="rounded-xl border border-dashed border-karimoff-line bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-karimoff-orange file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
          />
        </label>
        {warning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">
            {warning}
          </div>
        ) : null}
        <label className="grid gap-2 text-sm font-semibold">
          URL фона
          <input
            name={fieldKey}
            defaultValue={value ?? ""}
            placeholder="https://... или /assets/hero/..."
            className="rounded-xl border border-karimoff-line px-4 py-3 text-sm outline-none focus:border-karimoff-orange"
          />
        </label>
        <label className="flex items-center gap-3 text-sm font-semibold text-karimoff-muted">
          <input name={`clear_${fieldKey}`} type="checkbox" className="h-5 w-5 accent-karimoff-orange" />
          Очистить фон
        </label>
      </div>
    </div>
  );
}
