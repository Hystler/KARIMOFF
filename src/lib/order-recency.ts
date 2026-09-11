import { getMoscowDateKey } from "./order-time";

type OrderRecencyInput = {
  created_at: string;
  requested_at?: string | null;
  kitchen_status: string;
};

export function isStaleActiveOrder(order: OrderRecencyInput, now = new Date()) {
  if (["handed_out", "cancelled"].includes(order.kitchen_status)) return false;
  const effectiveAt = new Date(order.requested_at || order.created_at);
  if (Number.isNaN(effectiveAt.getTime()) || effectiveAt.getTime() > now.getTime()) return false;
  return getMoscowDateKey(effectiveAt) < getMoscowDateKey(now);
}
