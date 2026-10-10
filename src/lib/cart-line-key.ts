import type { CartCustomization } from "../components/cart/CartProvider";

export function makeCartLineId(productId: string, customization: CartCustomization) {
  const removed = customization.removed.map(item => item.ingredient_id).sort().join(",");
  const extras = customization.extras.map(item => `${item.ingredient_id}:${item.quantity}`).sort().join(",");
  const groups = [...customization.modifierOptionIds].sort().join(",");
  return `${productId}:${removed}|${extras}|${groups}|${customization.note.trim()}`;
}
