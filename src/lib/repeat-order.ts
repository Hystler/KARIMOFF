import type { Product } from "./product-types";
import type { CartCustomization } from "../components/cart/CartProvider";

export type RepeatOrderItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  item_note: string | null;
  configuration_snapshot: unknown;
  modifiers: Array<{
    ingredient_id: string | null;
    modifier_option_id: string | null;
    modifier_type: "remove" | "add" | "replace";
    ingredient_name: string;
    quantity: number;
  }>;
};

export type RepeatCartItem = { product: Product; quantity: number; customization: CartCustomization };
export type RepeatOrderIssue = { itemId: string; name: string; reason: string };
export type RepeatOrderResult = { items: RepeatCartItem[]; issues: RepeatOrderIssue[] };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function readConfiguration(item: RepeatOrderItem, product: Product): CartCustomization | null {
  const savedSnapshot = object(item.configuration_snapshot);
  // The migration backfilled older orders with an empty object. Treat that as legacy,
  // while rejecting partially populated modern snapshots rather than dropping choices.
  const snapshot = savedSnapshot && Object.keys(savedSnapshot).length > 0 ? savedSnapshot : null;
  const options = product.modifier_options ?? [];
  const selectedIds = snapshot?.modifier_option_ids;
  const removedIds = snapshot?.removed_ingredient_ids;
  const savedExtras = snapshot?.extras;
  // Modern orders store serving counts, not grams. Never infer them from historical prices.
  if (snapshot && (!Array.isArray(selectedIds) || !Array.isArray(removedIds) || !Array.isArray(savedExtras))) return null;
  const groupIds = snapshot ? selectedIds as unknown[] : item.modifiers.filter(modifier => modifier.modifier_option_id).map(modifier => modifier.modifier_option_id);
  const removed = snapshot ? removedIds as unknown[] : item.modifiers.filter(modifier => !modifier.modifier_option_id && modifier.modifier_type === "remove").map(modifier => modifier.ingredient_id);
  // Older rows store extra grams, not the original portion count. If the serving changed,
  // dividing by today's grams would silently change the order. Ask for a fresh choice instead.
  if (!snapshot && item.modifiers.some(modifier => !modifier.modifier_option_id && modifier.modifier_type !== "remove")) return null;
  const extras = snapshot ? savedExtras as unknown[] : [];
  if (groupIds.some(id => typeof id !== "string") || removed.some(id => typeof id !== "string")) return null;
  const allGroupIds = new Set((product.modifier_groups ?? []).flatMap(group => group.options.map(option => option.id)));
  const uniqueGroupIds = [...new Set(groupIds as string[])].sort();
  if (uniqueGroupIds.some(id => !allGroupIds.has(id))) return null;
  if (!(product.modifier_groups ?? []).every(group => {
    const count = group.options.filter(option => uniqueGroupIds.includes(option.id)).length;
    return count >= group.min_selections && count <= group.max_selections;
  })) return null;
  const resolvedRemoved: CartCustomization["removed"] = [];
  for (const id of new Set(removed as string[])) {
    const current = options.find(option => option.ingredient_id === id && option.is_removable);
    if (!current) return null;
    resolvedRemoved.push({ ingredient_id: current.ingredient_id, name: current.name });
  }
  const resolvedExtras = new Map<string, CartCustomization["extras"][number]>();
  for (const value of extras) {
    const extra = object(value);
    const current = options.find(option => option.ingredient_id === extra?.ingredient_id && option.is_extra_available);
    const quantity = Number(extra?.quantity);
    if (!current || !Number.isInteger(quantity) || quantity <= 0) return null;
    const total = quantity + (resolvedExtras.get(current.ingredient_id)?.quantity ?? 0);
    if (total > current.max_extra_quantity) return null;
    resolvedExtras.set(current.ingredient_id, { ingredient_id: current.ingredient_id, name: current.name, quantity: total, unit_price: current.extra_price });
  }
  return { removed: resolvedRemoved, extras: [...resolvedExtras.values()], modifierOptionIds: uniqueGroupIds, note: (item.item_note ?? "").trim().slice(0, 300) };
}

export function prepareRepeatOrder(items: RepeatOrderItem[], products: Product[]): RepeatOrderResult {
  const byId = new Map(products.filter(product => product.is_active).map(product => [product.id, product]));
  const result: RepeatOrderResult = { items: [], issues: [] };
  for (const item of items) {
    const product = item.product_id ? byId.get(item.product_id) : undefined;
    const issue = (reason: string) => result.issues.push({ itemId: item.id, name: item.product_name, reason });
    if (!product) { issue("Сейчас недоступен в меню"); continue; }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) { issue("Количество нужно выбрать заново"); continue; }
    const customization = readConfiguration(item, product);
    if (!customization) { issue("Состав изменился — выберите ингредиенты заново"); continue; }
    result.items.push({ product, quantity: item.quantity, customization });
  }
  return result;
}
