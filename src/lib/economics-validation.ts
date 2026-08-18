import "server-only";

import { z } from "zod";
import { normalizeEconomicsNumberText, type EconomicsFieldErrors } from "./economics-input";
import { economicsKeys, type EconomicsValues } from "./economics-values";

const percentKeys = new Set<keyof EconomicsValues>([
  "food_cost_percent",
  "royalty_percent",
  "acquiring_percent",
  "tax_percent",
  "misc_percent"
]);

const integerKeys = new Set<keyof EconomicsValues>(["working_days_per_month"]);

function numericField(key: keyof EconomicsValues) {
  const maximum = percentKeys.has(key)
    ? 100
    : key === "working_days_per_month"
      ? 31
      : key === "orders_per_day"
        ? 1_000_000
        : 1_000_000_000_000;

  let numberSchema = z.number().finite().min(0, "Значение не может быть отрицательным.").max(
    maximum,
    percentKeys.has(key)
      ? "Процент не может быть больше 100."
      : "Значение превышает допустимый предел."
  );

  if (integerKeys.has(key)) {
    numberSchema = numberSchema.int("Укажите целое количество дней.");
  }

  return z
    .string()
    .trim()
    .min(1, "Заполните поле.")
    .transform(normalizeEconomicsNumberText)
    .refine((value) => /^\d+(?:\.\d+)?$/.test(value), "Введите корректное число.")
    .transform(Number)
    .pipe(numberSchema);
}

const economicsInputSchema = z.object(
  Object.fromEntries(economicsKeys.map((key) => [key, numericField(key)])) as Record<
    keyof EconomicsValues,
    ReturnType<typeof numericField>
  >
);

export function validateEconomicsFormData(formData: FormData):
  | { success: true; values: EconomicsValues }
  | { success: false; fieldErrors: EconomicsFieldErrors } {
  const raw = Object.fromEntries(
    economicsKeys.map((key) => [key, String(formData.get(key) ?? "")])
  );
  const result = economicsInputSchema.safeParse(raw);

  if (result.success) {
    return { success: true, values: result.data as EconomicsValues };
  }

  const flattened = result.error.flatten().fieldErrors;
  return {
    success: false,
    fieldErrors: Object.fromEntries(
      economicsKeys.flatMap((key) => {
        const message = flattened[key]?.[0];
        return message ? [[key, message]] : [];
      })
    ) as EconomicsFieldErrors
  };
}
