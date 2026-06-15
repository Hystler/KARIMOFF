import { z } from "zod";

export const deliveryTypeSchema = z.enum(["pickup", "delivery"]);

export const orderCartLineSchema = z.object({
  product: z.object({
    id: z.string(),
    name: z.string().min(1),
    slug: z.string().optional(),
    price: z.number().min(0),
    image_url: z.string().nullable().optional()
  }),
  quantity: z.number().int().min(1).max(99)
});

export const createOrderSchema = z.object({
  delivery_type: deliveryTypeSchema,
  address: z.string().trim().max(300).optional(),
  comment: z.string().trim().max(800).optional(),
  cart: z.array(orderCartLineSchema).min(1, "Корзина пуста.")
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
