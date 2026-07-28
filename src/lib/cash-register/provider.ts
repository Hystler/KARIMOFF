import "server-only";

export type FiscalReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  vatCode?: string | null;
};

export type FiscalReceiptRequest = {
  orderId: string;
  idempotencyKey: string;
  amount: number;
  customerPhone: string;
  items: FiscalReceiptItem[];
};

export type FiscalReceiptResult =
  | { ok: true; providerReceiptId: string; payload?: Record<string, unknown> }
  | { ok: false; retryable: boolean; message: string };

export interface CashRegisterProvider {
  readonly id: string;
  createSaleReceipt(request: FiscalReceiptRequest): Promise<FiscalReceiptResult>;
  createRefundReceipt(request: FiscalReceiptRequest): Promise<FiscalReceiptResult>;
  getReceipt(providerReceiptId: string): Promise<FiscalReceiptResult>;
}

class DisabledCashRegisterProvider implements CashRegisterProvider {
  readonly id = "disabled";

  async createSaleReceipt(): Promise<FiscalReceiptResult> {
    return { ok: false, retryable: false, message: "Онлайн-касса не подключена." };
  }

  async createRefundReceipt(): Promise<FiscalReceiptResult> {
    return { ok: false, retryable: false, message: "Онлайн-касса не подключена." };
  }

  async getReceipt(): Promise<FiscalReceiptResult> {
    return { ok: false, retryable: false, message: "Онлайн-касса не подключена." };
  }
}

export function getCashRegisterProvider(): CashRegisterProvider {
  // Боевой адаптер Эвотор/АТОЛ подключается здесь после выбора ОФД и эквайера.
  return new DisabledCashRegisterProvider();
}
