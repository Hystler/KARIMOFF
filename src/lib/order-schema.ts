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
  address: z.string().trim().max(300).optional(),
  comment: z.string().trim().max(800).optional(),
  cart: z.array(orderCartLineSchema).min(1, "Корзина пуста.").max(50, "Слишком много позиций.")
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type OrderActionState = {
  status: "idle" | "success" | "error";
  message: string;
  orderId?: string;
};

export const initialOrderActionState: OrderActionState = {
  status: "idle",
  message: ""
};
