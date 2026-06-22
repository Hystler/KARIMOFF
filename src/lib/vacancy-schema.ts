import { z } from "zod";

export const vacancyFormSchema = z.object({
  title: z.string().trim().min(2, "Укажите название вакансии").max(140, "Название слишком длинное"),
  slug: z
    .string()
    .trim()
    .min(2, "Укажите slug")
    .max(140, "Slug слишком длинный")
    .regex(/^[a-z0-9-]+$/, "Slug может содержать только латиницу, цифры и дефис"),
  department: z.string().trim().max(120, "Отдел слишком длинный").optional(),
  employment_type: z.string().trim().max(120, "Формат занятости слишком длинный").optional(),
  salary_from: z.coerce.number().min(0, "Зарплата не может быть отрицательной").optional(),
  salary_to: z.coerce.number().min(0, "Зарплата не может быть отрицательной").optional(),
  salary_unit: z.string().trim().max(40, "Единица слишком длинная").default("hour"),
  location: z.string().trim().max(160, "Локация слишком длинная").optional(),
  schedule: z.string().trim().max(160, "График слишком длинный").optional(),
  description: z.string().trim().max(1400, "Описание слишком длинное").optional(),
  requirements: z.string().trim().max(1800, "Требования слишком длинные").optional(),
  responsibilities: z.string().trim().max(1800, "Обязанности слишком длинные").optional(),
  benefits: z.string().trim().max(1800, "Условия слишком длинные").optional(),
  sort_order: z.coerce.number().int().min(0, "Порядок не может быть отрицательным"),
  is_active: z.coerce.boolean().default(false)
});

export type VacancyFormInput = z.infer<typeof vacancyFormSchema>;
