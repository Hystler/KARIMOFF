export const ORDER_SOURCES = ["web", "pos", "mobile", "kiosk", "aggregator"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const KITCHEN_STATUSES = [
  "new",
  "accepted",
  "cooking",
  "ready",
  "handed_out",
  "cancelled"
] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export type OrderActorRole = "owner" | "admin" | "manager" | "cashier" | "cook";

export type OrderFlowModifier = {
  id: string;
  ingredientId: string | null;
  type: "remove" | "add";
  name: string;
  quantity: number;
  unit: string;
};

export type PublicDisplayOrder = Pick<
  OrderFlowOrder,
  | "id"
  | "displayNumber"
  | "kitchenStatus"
  | "publicDisplayName"
  | "publicAvatarSeed"
  | "publicAvatar"
>;

export type OrderFlowItem = {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers: OrderFlowModifier[];
  recipe: OrderRecipe | null;
};

export type OrderFlowOrder = {
  id: string;
  displayNumber: string;
  source: OrderSource;
  locationId: string;
  locationName: string;
  createdAt: string;
  acceptedAt: string | null;
  cookingStartedAt: string | null;
  readyAt: string | null;
  handedOutAt: string | null;
  requestedAt: string | null;
  kitchenStatus: KitchenStatus;
  orderStatus: string;
  paymentStatus: string;
  fiscalStatus: string;
  publicDisplayName: string;
  publicAvatarSeed: string;
  publicAvatar: {
    base: string;
    eyes: string;
    mouth: string;
    accessory: string;
    clothes: string;
    background: string;
  } | null;
  fulfillmentType: "pickup" | "delivery";
  fulfillmentMode: "asap" | "scheduled";
  comment: string | null;
  address: string | null;
  total: number;
  assignedStaffName: string | null;
  items: OrderFlowItem[];
};

export type OrderLocation = {
  id: string;
  key: string;
  name: string;
  timezone: string;
  isDefault: boolean;
};

export type KitchenSla = {
  warningSeconds: number;
  criticalSeconds: number;
  readyDisplaySeconds: number;
  onlineRequiresPaid: boolean;
  posRequiresPaid: boolean;
  inventoryTrigger: "ready";
};

export type KitchenOperationsMetrics = {
  ordersToday: number;
  averageAcceptanceSeconds: number | null;
  averageCookingSeconds: number | null;
  averageTotalSeconds: number | null;
  medianTotalSeconds: number | null;
  p90TotalSeconds: number | null;
  averagePickupWaitSeconds: number | null;
  slaCompliancePercent: number | null;
  throughputLastHour: number;
};

export type RecipeLine = {
  id: string;
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string;
  sortOrder: number;
  step: string | null;
  note: string | null;
  imageUrl: string | null;
  station: string | null;
  preparationTimeSeconds: number | null;
};

export type OrderRecipe = {
  productId: string;
  productName: string;
  allergens: string[];
  quantity: number;
  lines: RecipeLine[];
};

export const kitchenTransitionMap: Record<KitchenStatus, KitchenStatus[]> = {
  new: ["accepted", "cancelled"],
  accepted: ["cooking", "cancelled"],
  cooking: ["ready", "cancelled"],
  ready: ["handed_out"],
  handed_out: [],
  cancelled: []
};

export function orderSourceLabel(source: OrderSource) {
  if (source === "web") return "Сайт";
  if (source === "pos") return "Касса";
  if (source === "mobile") return "Приложение";
  if (source === "kiosk") return "Киоск";
  return "Агрегатор";
}

export function kitchenStatusLabel(status: KitchenStatus) {
  if (status === "new") return "Новый";
  if (status === "accepted") return "Принят";
  if (status === "cooking") return "Готовится";
  if (status === "ready") return "Готов";
  if (status === "handed_out") return "Выдан";
  return "Отменён";
}
