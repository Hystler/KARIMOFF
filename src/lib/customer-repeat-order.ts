import "server-only";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getActiveProductsByIds } from "@/lib/products";
import { prepareRepeatOrder, type RepeatOrderItem } from "@/lib/repeat-order";

export async function getCustomerRepeatOrder(customerId: string, orderId: string) {
  const database = createDatabaseServerClient();
  if (!database) throw new Error("Order unavailable");
  // Ownership is checked before reading any order items or resolving products.
  const { data: order, error: orderError } = await database.from("orders")
    .select("id, payment_status").eq("id", orderId).eq("customer_id", customerId).maybeSingle();
  if (orderError) throw new Error("Order unavailable");
  if (!order || !["paid", "partially_refunded", "refunded"].includes(String(order.payment_status))) return null;
  const { data, error } = await database.from("order_items")
    .select("id, product_id, product_name, quantity, item_note, configuration_snapshot").eq("order_id", orderId).eq("item_type", "food").order("id", { ascending: true });
  if (error) throw new Error("Order items unavailable");
  const ids = (data ?? []).map(item => String(item.id));
  const modifiers = ids.length ? await database.from("order_item_modifiers")
    .select("order_item_id, ingredient_id, modifier_option_id, modifier_type, ingredient_name, quantity").in("order_item_id", ids) : { data: [], error: null };
  if (modifiers.error) throw new Error("Order modifiers unavailable");
  const items: RepeatOrderItem[] = (data ?? []).map(item => ({
    id: String(item.id), product_id: typeof item.product_id === "string" ? item.product_id : null,
    product_name: String(item.product_name ?? ""), quantity: Number(item.quantity),
    item_note: typeof item.item_note === "string" ? item.item_note : null,
    configuration_snapshot: item.configuration_snapshot,
    modifiers: (modifiers.data ?? []).filter(modifier => String(modifier.order_item_id) === String(item.id)).map(modifier => ({
      ingredient_id: typeof modifier.ingredient_id === "string" ? modifier.ingredient_id : null,
      modifier_option_id: typeof modifier.modifier_option_id === "string" ? modifier.modifier_option_id : null,
      modifier_type: modifier.modifier_type === "remove" || modifier.modifier_type === "replace" ? modifier.modifier_type : "add",
      ingredient_name: String(modifier.ingredient_name ?? ""), quantity: Number(modifier.quantity)
    }))
  }));
  const products = await getActiveProductsByIds(items.flatMap(item => item.product_id ? [item.product_id] : []));
  return prepareRepeatOrder(items, products);
}
