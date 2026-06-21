import { z } from "zod";

export const leadInterestSchema = z.enum(["b2b", "career", "franchise", "other"]);

export const leadFormSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(80, "Имя слишком длинное"),
  phone: z.string().trim().min(6, "Укажите телефон").max(32, "Телефон слишком длинный"),
  interest: leadInterestSchema,
  comment: z.string().trim().max(1000, "Комментарий слишком длинный").optional()
});

export type LeadFormInput = z.infer<typeof leadFormSchema>;

export type LeadActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialLeadActionState: LeadActionState = {
  status: "idle",
  message: ""
};
