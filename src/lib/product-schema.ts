import { z } from "zod";

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
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным"),
  is_active: z.coerce.boolean().default(false)
});

export type ProductFormInput = z.infer<typeof productFormSchema>;
