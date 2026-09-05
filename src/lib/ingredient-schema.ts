import { z } from "zod";

export const ingredientUnitSchema = z.enum(["g", "ml", "pcs"]);
export const productStationSchema = z.enum(["grill", "fryer", "assembly", "drinks", "packing"]);

function optionalNutritionValue() {
  return z.preprocess(
    (value) => value === "" || value === null || value === undefined ? undefined : value,
    z.coerce.number().min(0, "Значение КБЖУ не может быть отрицательным").optional()
  );
}

export const ingredientFormSchema = z.object({
  name: z.string().trim().min(2, "Укажите название").max(120, "Название слишком длинное"),
  category: z.string().trim().max(80, "Категория слишком длинная").optional(),
  unit: ingredientUnitSchema,
  package_size: z.coerce.number().min(0, "Размер упаковки не может быть отрицательным").optional(),
  package_price: z.coerce.number().min(0, "Цена упаковки не может быть отрицательной").optional(),
  cost_per_unit: z.coerce.number().min(0, "Себестоимость не может быть отрицательной").optional(),
  waste_percent: z.coerce.number().min(0, "Процент отходов не может быть отрицательным").max(95, "Процент отходов не может быть больше 95"),
  calories_kcal: optionalNutritionValue(),
  proteins_g: optionalNutritionValue(),
  fats_g: optionalNutritionValue(),
  carbohydrates_g: optionalNutritionValue(),
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным"),
  is_active: z.coerce.boolean().default(false)
}).superRefine((value, context) => {
  const nutrition = [value.calories_kcal, value.proteins_g, value.fats_g, value.carbohydrates_g];
  const filled = nutrition.filter((item) => item !== undefined).length;

  if (filled > 0 && filled < nutrition.length) {
    context.addIssue({
      code: "custom",
      message: "Заполните все четыре значения КБЖУ или оставьте весь блок пустым"
    });
  }
});

export const ingredientPriceSchema = z
  .object({
    id: z.string().uuid("Некорректный ингредиент"),
    package_size: z.coerce.number().positive("Укажите размер упаковки больше нуля").optional(),
    package_price: z.coerce.number().positive("Укажите цену упаковки больше нуля").optional(),
    cost_per_unit: z.coerce.number().min(0, "Себестоимость не может быть отрицательной").optional(),
    waste_percent: z.coerce.number().min(0).max(95)
  })
  .superRefine((value, context) => {
    const hasPackageSize = value.package_size !== undefined;
    const hasPackagePrice = value.package_price !== undefined;

    if (hasPackageSize !== hasPackagePrice) {
      context.addIssue({
        code: "custom",
        message: "Для автоматического расчёта заполните и размер, и цену упаковки"
      });
    }

    if (!hasPackageSize && value.cost_per_unit === undefined) {
      context.addIssue({
        code: "custom",
        message: "Заполните упаковку или себестоимость за единицу"
      });
    }
  });

export const productIngredientFormSchema = z.object({
  product_id: z.string().uuid("Некорректный товар"),
  ingredient_id: z.string().uuid("Выберите ингредиент"),
  quantity: z.coerce.number().min(0.001, "Укажите количество"),
  unit: ingredientUnitSchema,
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным").default(100),
  is_removable: z.coerce.boolean().default(false),
  is_extra_available: z.coerce.boolean().default(false),
  extra_quantity: z.coerce.number().min(0, "Порция добавки не может быть отрицательной").default(0),
  extra_price: z.coerce.number().min(0, "Доплата не может быть отрицательной").default(0),
  max_extra_quantity: z.coerce.number().int().min(1).max(10).default(1),
  preparation_step: z.string().trim().max(500, "Шаг приготовления слишком длинный").optional(),
  preparation_note: z.string().trim().max(500, "Заметка слишком длинная").optional(),
  preparation_image_url: z.string().trim().url("Укажите корректную ссылку на фото").max(2000).optional().or(z.literal("")),
  station: productStationSchema.optional().or(z.literal("")),
  preparation_time_seconds: z.coerce.number().int().min(0).max(14_400).optional()
});

export type IngredientFormInput = z.infer<typeof ingredientFormSchema>;
export type IngredientPriceInput = z.infer<typeof ingredientPriceSchema>;
export type ProductIngredientFormInput = z.infer<typeof productIngredientFormSchema>;
