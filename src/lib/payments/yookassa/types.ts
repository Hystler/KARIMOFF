export type YooKassaCurrency = "RUB";

export type YooKassaAmount = {
  value: string;
  currency: YooKassaCurrency;
};

export type YooKassaReceiptRegistration = "pending" | "succeeded" | "canceled";
export type YooKassaPaymentStatus = "pending" | "waiting_for_capture" | "succeeded" | "canceled";
export type YooKassaRefundStatus = "pending" | "succeeded" | "canceled";
export type YooKassaReceiptStatus = "pending" | "succeeded" | "canceled";
export type YooKassaPaymentMode = "full_prepayment" | "full_payment";

export type YooKassaReceiptItem = {
  description: string;
  quantity: number;
  amount: YooKassaAmount;
  vat_code: 1;
  payment_mode: YooKassaPaymentMode;
  payment_subject: "commodity";
  measure: "piece";
};

export type YooKassaReceipt = {
  customer: { email: string };
  items: YooKassaReceiptItem[];
  internet: true;
};

export type YooKassaFiscalRequestSnapshot = {
  internet: true;
  items: YooKassaReceiptItem[];
  send?: true;
  settlements?: Array<{
    type: "prepayment";
    amount: YooKassaAmount;
  }>;
};

export type YooKassaPayment = {
  id: string;
  status: YooKassaPaymentStatus;
  paid: boolean;
  amount: YooKassaAmount;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
  };
  created_at?: string;
  captured_at?: string;
  expires_at?: string;
  description?: string;
  metadata?: Record<string, string>;
  payment_method?: { type?: string };
  receipt_registration?: YooKassaReceiptRegistration;
  refundable?: boolean;
  refunded_amount?: YooKassaAmount;
  test?: boolean;
};

export type YooKassaRefund = {
  id: string;
  payment_id: string;
  status: YooKassaRefundStatus;
  amount: YooKassaAmount;
  created_at?: string;
  receipt_registration?: YooKassaReceiptRegistration;
};

export type YooKassaProviderReceipt = {
  id: string;
  type: "payment" | "refund";
  payment_id?: string;
  refund_id?: string;
  status: YooKassaReceiptStatus;
  items?: YooKassaReceiptItem[];
  registered_at?: string;
};

export type CreateYooKassaPaymentInput = {
  amount: YooKassaAmount;
  capture: true;
  confirmation: {
    type: "redirect";
    return_url: string;
  };
  description: string;
  metadata: Record<string, string>;
  receipt: YooKassaReceipt;
};

export type CreateYooKassaRefundInput = {
  amount: YooKassaAmount;
  payment_id: string;
  description?: string;
  receipt?: YooKassaReceipt;
};

export type CreateYooKassaReceiptInput = {
  type: "payment";
  payment_id: string;
  customer: { email: string };
  items: YooKassaReceiptItem[];
  internet: true;
  send: true;
  settlements: Array<{
    type: "prepayment";
    amount: YooKassaAmount;
  }>;
};
