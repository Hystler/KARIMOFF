import { z } from "zod";

export const siteThemeSchema = z.enum(["light", "dark"]);

export const siteSettingsSchema = z.object({
  site_name: z.string().trim().min(1, "Укажите название сайта").max(120, "Название слишком длинное"),
  phone: z.string().trim().max(80, "Телефон слишком длинный").optional(),
  address: z.string().trim().max(240, "Адрес слишком длинный").optional(),
  working_hours: z.string().trim().max(160, "Часы работы слишком длинные").optional(),
  delivery_enabled: z.coerce.boolean().default(false),
  pickup_enabled: z.coerce.boolean().default(false),
  theme: siteThemeSchema,
  loyalty_enabled: z.coerce.boolean().default(false),
  loyalty_percent: z.coerce.number().min(0, "Процент не может быть отрицательным").max(100, "Процент слишком высокий"),
  hero_title: z.string().trim().max(160, "Заголовок слишком длинный").optional(),
  hero_subtitle: z.string().trim().max(240, "Подзаголовок слишком длинный").optional(),
  home_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional(),
  menu_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional(),
  business_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional(),
  careers_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional(),
  franchise_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional(),
  about_hero_image_url: z.string().trim().max(500, "Ссылка на фон слишком длинная").optional()
});

export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;
