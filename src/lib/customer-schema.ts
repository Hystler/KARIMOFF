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

export const registerRequestSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(80, "Имя слишком длинное"),
  phone: phoneSchema
});

export const loginRequestSchema = z.object({
  phone: phoneSchema
});

export const registerConfirmSchema = registerRequestSchema.extend({
  code: verificationCodeSchema,
  next: z.string().optional()
});

export const loginConfirmSchema = loginRequestSchema.extend({
  code: verificationCodeSchema,
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
