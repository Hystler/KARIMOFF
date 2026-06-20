import { z } from "zod";

export const ingredientUnitSchema = z.enum(["g", "ml", "pcs"]);

export const ingredientFormSchema = z.object({
  name: z.string().trim().min(2, "Укажите название").max(120, "Название слишком длинное"),
  category: z.string().trim().max(80, "Категория слишком длинная").optional(),
  unit: ingredientUnitSchema,
  package_size: z.coerce.number().min(0, "Размер упаковки не может быть отрицательным").optional(),
  package_price: z.coerce.number().min(0, "Цена упаковки не может быть отрицательной").optional(),
  cost_per_unit: z.coerce.number().min(0, "Себестоимость не может быть отрицательной").optional(),
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным"),
  is_active: z.coerce.boolean().default(false)
});

export const productIngredientFormSchema = z.object({
  product_id: z.string().uuid("Некорректный товар"),
  ingredient_id: z.string().uuid("Выберите ингредиент"),
  quantity: z.coerce.number().min(0.001, "Укажите количество"),
  unit: ingredientUnitSchema,
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным").default(100)
});

export type IngredientFormInput = z.infer<typeof ingredientFormSchema>;
export type ProductIngredientFormInput = z.infer<typeof productIngredientFormSchema>;
