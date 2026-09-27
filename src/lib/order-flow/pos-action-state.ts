export type PosOrderActionState = {
  status: "idle" | "success" | "error";
  message: string;
  orderId?: string;
  displayNumber?: string;
  paymentIntentId?: string;
  paymentStatus?: "queued" | "processing" | "paid" | "failed" | "cancelled" | "unknown";
  amount?: number;
  resetKey?: string;
};

export const initialPosOrderActionState: PosOrderActionState = {
  status: "idle",
  message: ""
};
