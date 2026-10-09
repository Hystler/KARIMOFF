import { z } from "zod";

export const deliveryTypeSchema = z.enum(["pickup", "delivery"]);
export const fulfillmentModeSchema = z.enum(["asap", "scheduled"]);

export const orderCartLineSchema = z.object({
  product_id: z.string().uuid("Некорректный товар."),
  quantity: z.number().int().min(1).max(20),
  removed_ingredient_ids: z.array(z.string().uuid()).max(20).default([]),
  extras: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(10)
      })
    )
    .max(20)
    .default([]),
  modifier_option_ids: z.array(z.string().uuid()).max(20).default([]),
  note: z.string().trim().max(300).default("")
});

export const createOrderSchema = z.object({
  delivery_type: deliveryTypeSchema,
  fulfillment_mode: fulfillmentModeSchema,
  requested_at: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  delivery_address_id: z.string().uuid().or(z.literal("")).optional().default(""),
  delivery_apartment: z.string().trim().max(30).optional().default(""),
  delivery_entrance: z.string().trim().max(30).optional().default(""),
  delivery_floor: z.string().trim().max(30).optional().default(""),
  delivery_intercom: z.string().trim().max(60).optional().default(""),
  delivery_courier_comment: z.string().trim().max(500).optional().default(""),
  comment: z.string().trim().max(800).optional(),
  receipt_email: z.string().trim().toLowerCase().email("Укажите корректную электронную почту для чека."),
  cart: z.array(orderCartLineSchema).min(1, "Корзина пуста.").max(50, "Слишком много позиций.")
}).superRefine((value, context) => {
  if (value.delivery_type === "delivery" && value.fulfillment_mode !== "asap") {
    context.addIssue({ code: "custom", path: ["fulfillment_mode"], message: "Доставка оформляется как можно скорее." });
  }
  if (value.delivery_type === "delivery" && !value.delivery_address_id) {
    context.addIssue({ code: "custom", path: ["delivery_address_id"], message: "Выберите дом из списка." });
  }
  if (value.delivery_type === "pickup" && value.delivery_address_id) {
    context.addIssue({ code: "custom", path: ["delivery_address_id"], message: "Для самовывоза адрес не нужен." });
  }
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type OrderActionState = {
  status: "idle" | "success" | "error";
  message: string;
  orderId?: string;
  paymentConfirmationUrl?: string;
  paymentId?: string;
  stagingPreview?: boolean;
};

export const initialOrderActionState: OrderActionState = {
  status: "idle",
  message: ""
};
