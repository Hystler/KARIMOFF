import type { CartLine } from "../components/cart/CartProvider";
import type { RepeatCartItem } from "./repeat-order";
import { makeCartLineId } from "./cart-line-key";

export function buildReplacementCartLines(items: RepeatCartItem[]): CartLine[] {
  const lines = new Map<string, CartLine>();
  for (const { product, quantity, customization } of items) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Недопустимое количество товара");
    const lineId = makeCartLineId(product.id, customization);
    const totalQuantity = quantity + (lines.get(lineId)?.quantity ?? 0);
    if (totalQuantity > 20) throw new Error("В одной позиции можно заказать не больше 20 порций");
    lines.set(lineId, { lineId, product: {
      id: product.id, name: product.name, slug: product.slug, price: product.price, image_url: product.image_url,
      modifier_options: product.modifier_options ?? [], modifier_groups: product.modifier_groups ?? []
    }, quantity: totalQuantity, customization });
  }
  return [...lines.values()];
}
