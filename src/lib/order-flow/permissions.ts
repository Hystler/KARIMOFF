import {
  kitchenTransitionMap,
  type KitchenSla,
  type KitchenStatus,
  type OrderActorRole,
  type OrderFlowOrder
} from "./types";

export function canAccessKitchen(role: OrderActorRole) {
  return ["owner", "admin", "manager", "cashier", "cook"].includes(role);
}

export function canCreatePosOrder(role: OrderActorRole) {
  return ["owner", "admin", "manager", "cashier"].includes(role);
}

export function canCancelOrder(role: OrderActorRole) {
  return ["owner", "admin", "manager"].includes(role);
}

export function canHandOutOrder(role: OrderActorRole) {
  return ["owner", "admin", "manager", "cashier"].includes(role);
}

export function canTransitionKitchen(
  role: OrderActorRole,
  from: KitchenStatus,
  to: KitchenStatus
) {
  if (!kitchenTransitionMap[from].includes(to)) return false;
  if (["owner", "admin", "manager"].includes(role)) return true;
  if (role === "cashier") return from === "ready" && to === "handed_out";
  return role === "cook" && (
    (from === "new" && to === "accepted") ||
    (from === "accepted" && to === "cooking") ||
    (from === "cooking" && to === "ready")
  );
}

export function isOrderVisibleToKitchen(order: OrderFlowOrder, sla: KitchenSla) {
  const paid = order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded";
  if ((order.source === "web" || order.source === "mobile") && sla.onlineRequiresPaid) return paid;
  if ((order.source === "pos" || order.source === "kiosk") && sla.posRequiresPaid) return paid;
  return true;
}
