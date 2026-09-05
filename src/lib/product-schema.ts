import { z } from "zod";
import { ingredientUnitSchema, productStationSchema } from "./ingredient-schema";

export const productFormSchema = z.object({
  name: z.string().trim().min(2, "Укажите название").max(120, "Название слишком длинное"),
  slug: z
    .string()
    .trim()
    .min(2, "Укажите slug")
    .max(120, "Slug слишком длинный")
    .regex(/^[a-z0-9-]+$/, "Slug может содержать только латиницу, цифры и дефис"),
  category: z.string().trim().min(2, "Укажите категорию").max(80, "Категория слишком длинная"),
  description: z.string().trim().max(800, "Описание слишком длинное").optional(),
  price: z.coerce.number().min(0, "Цена не может быть отрицательной"),
  image_url: z.string().trim().max(500, "Ссылка слишком длинная").optional(),
  weight: z.string().trim().max(80, "Вес указан слишком длинно").optional(),
  allergens: z.string().trim().max(500, "Список аллергенов слишком длинный").optional(),
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным"),
  is_active: z.coerce.boolean().default(false)
});

export const productCompositionDraftSchema = z.array(z.object({
  ingredient_id: z.string().uuid("Выберите ингредиент"),
  quantity: z.coerce.number().positive("Количество ингредиента должно быть больше нуля"),
  unit: ingredientUnitSchema,
  sort_order: z.coerce.number().int().min(0).default(100),
  station: productStationSchema.optional().or(z.literal(""))
})).min(1, "Добавьте хотя бы один ингредиент").max(100, "В рецептуре слишком много строк");

export type ProductFormInput = z.infer<typeof productFormSchema>;
export type ProductCompositionDraftInput = z.infer<typeof productCompositionDraftSchema>;
