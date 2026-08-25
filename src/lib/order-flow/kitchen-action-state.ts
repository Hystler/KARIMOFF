export type KitchenActionState = {
  status: "idle" | "success" | "error";
  message: string;
  warnings?: string[];
};

export const initialKitchenActionState: KitchenActionState = {
  status: "idle",
  message: ""
};
