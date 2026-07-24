import { z } from "zod";

export const deliveryTypeSchema = z.enum(["pickup", "delivery"]);

export const orderCartLineSchema = z.object({
  product_id: z.string().uuid("Некорректный товар."),
  quantity: z.number().int().min(1).max(20)
});

export const createOrderSchema = z.object({
  delivery_type: deliveryTypeSchema,
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
