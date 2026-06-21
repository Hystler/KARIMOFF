import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Укажите телефон")
  .max(24, "Телефон слишком длинный");

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Код должен состоять из 6 цифр");

export const passwordSchema = z
  .string()
  .min(6, "Пароль должен быть не короче 6 символов")
  .max(120, "Пароль слишком длинный");

export const passwordRegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Укажите имя").max(80, "Имя слишком длинное"),
    phone: phoneSchema,
    password: passwordSchema,
    password_confirm: z.string(),
    redirectTo: z.string().optional(),
    next: z.string().optional()
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"]
  });

export const passwordLoginSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  redirectTo: z.string().optional(),
  next: z.string().optional()
});

export const registerRequestSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(80, "Имя слишком длинное"),
  phone: phoneSchema
});

export const loginRequestSchema = z.object({
  phone: phoneSchema
});

export const registerConfirmSchema = registerRequestSchema.extend({
  code: verificationCodeSchema,
  redirectTo: z.string().optional(),
  next: z.string().optional()
});

export const loginConfirmSchema = loginRequestSchema.extend({
  code: verificationCodeSchema,
  redirectTo: z.string().optional(),
  next: z.string().optional()
});

export type AuthActionState = {
  status: "idle" | "code_sent" | "success" | "error";
  message: string;
  phone?: string;
  name?: string;
};

export const initialAuthActionState: AuthActionState = {
  status: "idle",
  message: ""
};
