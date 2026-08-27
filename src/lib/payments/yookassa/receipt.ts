import { multiplyMoney, moneyToMinorUnits, rubles } from "./money";
import type {
  CreateYooKassaReceiptInput,
  YooKassaFiscalRequestSnapshot,
  YooKassaPaymentMode,
  YooKassaReceipt,
  YooKassaReceiptItem
} from "./types";

export const YOOKASSA_FISCAL_CONFIG = Object.freeze({
  internet: true as const,
  measure: "piece" as const,
  paymentSubject: "commodity" as const,
  vatCode: 1 as const
});

export type FiscalOrderModifier = {
  ingredientName: string;
  modifierType: "add" | "remove" | "replace";
};

export type FiscalOrderItem = {
  lineTotal: string;
  modifiers?: FiscalOrderModifier[];
  orderItemId?: string;
  productName: string;
  quantity: number;
  unitPrice: string;
};

function validateEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("INVALID_RECEIPT_EMAIL");
  }
  return value;
}

function compactDescription(item: FiscalOrderItem) {
  const modifiers = item.modifiers ?? [];
  const labels = modifiers.map((modifier) => {
    if (modifier.modifierType === "remove") return `без ${modifier.ingredientName}`;
    if (modifier.modifierType === "replace") return `замена: ${modifier.ingredientName}`;
    return `+ ${modifier.ingredientName}`;
  });
  const suffix = labels.length ? ` (${labels.join(", ")})` : "";
  const value = `${item.productName.trim()}${suffix}`.replace(/\s+/g, " ");
  return value.slice(0, 128).trim();
}

export function buildReceiptItems(
  items: FiscalOrderItem[],
  paymentMode: YooKassaPaymentMode,
  expectedTotal: string
): YooKassaReceiptItem[] {
  if (!items.length || items.length > 80) throw new Error("INVALID_RECEIPT_ITEM_COUNT");

  let total = BigInt(0);
  const result = items.map((item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("INVALID_RECEIPT_QUANTITY");
    }
    if (moneyToMinorUnits(item.unitPrice) <= BigInt(0)) {
      throw new Error("INVALID_RECEIPT_ITEM_AMOUNT");
    }
    const calculatedLineTotal = multiplyMoney(item.unitPrice, item.quantity);
    if (calculatedLineTotal !== moneyToMinorUnits(item.lineTotal)) {
      throw new Error("RECEIPT_LINE_TOTAL_MISMATCH");
    }
    total += calculatedLineTotal;
    return {
      description: compactDescription(item),
      quantity: item.quantity,
      amount: rubles(item.unitPrice),
      vat_code: YOOKASSA_FISCAL_CONFIG.vatCode,
      payment_mode: paymentMode,
      payment_subject: YOOKASSA_FISCAL_CONFIG.paymentSubject,
      measure: YOOKASSA_FISCAL_CONFIG.measure
    } satisfies YooKassaReceiptItem;
  });

  if (total !== moneyToMinorUnits(expectedTotal)) throw new Error("RECEIPT_TOTAL_MISMATCH");
  return result;
}

export function buildPaymentReceipt(params: {
  email: string;
  expectedTotal: string;
  items: FiscalOrderItem[];
}): YooKassaReceipt {
  return {
    customer: { email: validateEmail(params.email) },
    items: buildReceiptItems(params.items, "full_prepayment", params.expectedTotal),
    internet: YOOKASSA_FISCAL_CONFIG.internet
  };
}

export function buildPrepaymentSettlementReceipt(params: {
  email: string;
  expectedTotal: string;
  items: FiscalOrderItem[];
  paymentId: string;
}): CreateYooKassaReceiptInput {
  return {
    type: "payment",
    payment_id: params.paymentId,
    customer: { email: validateEmail(params.email) },
    items: buildReceiptItems(params.items, "full_payment", params.expectedTotal),
    internet: YOOKASSA_FISCAL_CONFIG.internet,
    send: true,
    settlements: [{ type: "prepayment", amount: rubles(params.expectedTotal) }]
  };
}

export function buildPartialRefundReceipt(params: {
  email: string;
  expectedTotal: string;
  items: FiscalOrderItem[];
}): YooKassaReceipt {
  return {
    customer: { email: validateEmail(params.email) },
    items: buildReceiptItems(params.items, "full_prepayment", params.expectedTotal),
    internet: YOOKASSA_FISCAL_CONFIG.internet
  };
}

export function fiscalRequestSnapshot(
  receipt: YooKassaReceipt | CreateYooKassaReceiptInput
): YooKassaFiscalRequestSnapshot {
  return {
    internet: receipt.internet,
    items: receipt.items,
    ...("type" in receipt && receipt.type === "payment"
      ? { send: receipt.send, settlements: receipt.settlements }
      : {})
  };
}
