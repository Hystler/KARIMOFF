import type { KitchenStatus, OrderFlowItem, OrderFlowOrder } from "./types";

export const kitchenStations = ["snacks", "main"] as const;
export type KitchenStation = (typeof kitchenStations)[number];
export type KitchenView = "all" | "snacks" | "main";

export const kitchenStationLabels: Record<KitchenStation, string> = {
  snacks: "Закуски",
  main: "Основные блюда"
};

export function kitchenStationForCategory(category: string | null | undefined): KitchenStation {
  return /(бургер|burger|шаур|shaur|shawarma|ролл|roll|хот.?дог|hot.?dog)/i.test(category ?? "") ? "main" : "snacks";
}

export function stationItems(order: OrderFlowOrder, station: KitchenView) {
  return station === "all" ? order.items : order.items.filter((item) => item.kitchenStation === station);
}

export function stationStatus(items: OrderFlowItem[]): KitchenStatus {
  if (items.length && items.every((item) => item.kitchenStatus === "ready")) return "ready";
  if (items.some((item) => item.kitchenStatus !== "new")) return "cooking";
  return "new";
}

export function kitchenViewStatus(order: OrderFlowOrder, view: KitchenView): KitchenStatus {
  return view === "all" ? order.kitchenStatus : stationStatus(stationItems(order, view));
}
