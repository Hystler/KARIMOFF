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
  if (role === "cashier") {
    return (from === "ready" && (to === "handed_out" || to === "handed_to_courier"))
      || (from === "handed_to_courier" && to === "handed_out");
  }
  return role === "cook" && (
    (from === "new" && to === "cooking") ||
    (from === "accepted" && to === "cooking") ||
    (from === "cooking" && to === "ready")
  );
}

export function isOrderVisibleToKitchen(order: OrderFlowOrder, sla: KitchenSla) {
  // Test orders exercise the full operational flow without depending on a real payment provider.
  if (order.isTest) return true;
  // A terminal command is not payment evidence; the bridge marks paid only with a receipt reference.
  if (order.source === "pos" && order.paymentProvider === "evotor") {
    return ["paid", "partially_refunded"].includes(order.paymentStatus)
      && ["issued", "partially_refunded"].includes(order.fiscalStatus);
  }
  const paid = order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded";
  if ((order.source === "web" || order.source === "mobile") && sla.onlineRequiresPaid) return paid;
  if ((order.source === "pos" || order.source === "kiosk") && sla.posRequiresPaid) return paid;
  return true;
}

export function isPickupDisplayOrder(order: Pick<OrderFlowOrder, "fulfillmentType" | "kitchenStatus">) {
  return order.fulfillmentType === "pickup"
    && !["handed_to_courier", "handed_out", "cancelled"].includes(order.kitchenStatus);
}
