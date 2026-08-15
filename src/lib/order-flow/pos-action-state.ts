export type PosOrderActionState = {
  status: "idle" | "success" | "error";
  message: string;
  orderId?: string;
  displayNumber?: string;
  resetKey?: string;
};

export const initialPosOrderActionState: PosOrderActionState = {
  status: "idle",
  message: ""
};
