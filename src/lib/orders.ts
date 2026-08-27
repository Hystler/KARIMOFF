import "server-only";

import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";

export type AdminOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  item_note: string | null;
  modifiers: AdminOrderItemModifier[];
};

export type AdminOrderItemModifier = {
  id: string;
  modifier_type: "remove" | "add" | "replace";
  ingredient_name: string;
  quantity: number;
  unit: string;
  line_price_delta: number;
};

export type AdminFiscalReceipt = {
  amount: string;
  created_at: string;
  fiscalized_at: string | null;
  id: string;
  items: AdminFiscalReceiptItem[];
  last_error_code: string | null;
  provider_status: string | null;
  provider_receipt_id: string | null;
  receipt_phase: string;
  receipt_registration: string | null;
  receipt_type: string;
  status: string;
};

export type AdminFiscalReceiptItem = {
  amount: string;
  description: string;
  payment_mode: string;
  payment_subject: string;
  quantity: number;
  vat_code: number;
};

export type AdminRefund = {
  amount: string;
  completed_at: string | null;
  created_at: string;
  id: string;
  provider_refund_id: string | null;
  provider_status: string | null;
  receipt_registration: string | null;
  status: string;
};

export type AdminPayment = {
  amount: string;
  created_at: string;
  currency: string;
  fiscal_receipts: AdminFiscalReceipt[];
  id: string;
  paid_at: string | null;
  payment_method: string | null;
  provider: string;
  provider_payment_id: string | null;
  provider_status: string | null;
  receipt_registration: string | null;
  refundable_amount: string;
  refunds: AdminRefund[];
  status: string;
};

export type AdminOrder = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  display_number: string;
  source: "web" | "pos" | "mobile" | "kiosk" | "aggregator";
  kitchen_status: "new" | "accepted" | "cooking" | "ready" | "handed_out" | "cancelled";
  delivery_type: "pickup" | "delivery";
  address: string | null;
  comment: string | null;
  status: "new" | "in_progress" | "completed" | "cancelled";
  payment_status: "not_required" | "pending" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
  fiscal_status: "not_required" | "pending" | "issued" | "failed" | "refunded";
  fulfillment_mode: "asap" | "scheduled";
  requested_at: string | null;
  kitchen_started_at: string | null;
  kitchen_completed_at: string | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  total: number;
  is_test: boolean;
  is_operational: boolean;
  items: AdminOrderItem[];
  payments: AdminPayment[];
};

function normalizeOrder(
  row: Record<string, unknown>,
  items: AdminOrderItem[],
  staffNames: Map<string, string>,
  payments: AdminPayment[]
): AdminOrder {
  const assignedStaffId = row.assigned_staff_id ? String(row.assigned_staff_id) : null;
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    customer_name: String(row.customer_name ?? ""),
    customer_phone: String(row.customer_phone ?? ""),
    display_number: row.display_number ? String(row.display_number) : "Архив",
    source:
      row.source === "pos" || row.source === "mobile" || row.source === "kiosk" || row.source === "aggregator"
        ? row.source
        : "web",
    kitchen_status:
      row.kitchen_status === "accepted" ||
      row.kitchen_status === "cooking" ||
      row.kitchen_status === "ready" ||
      row.kitchen_status === "handed_out" ||
      row.kitchen_status === "cancelled"
        ? row.kitchen_status
        : "new",
    delivery_type: row.delivery_type === "delivery" ? "delivery" : "pickup",
    address: typeof row.address === "string" ? row.address : null,
    comment: typeof row.comment === "string" ? row.comment : null,
    status:
      row.status === "in_progress" || row.status === "completed" || row.status === "cancelled"
        ? row.status
        : "new",
    payment_status:
      row.payment_status === "pending" ||
      row.payment_status === "paid" ||
      row.payment_status === "failed" ||
      row.payment_status === "cancelled" ||
      row.payment_status === "refunded" ||
      row.payment_status === "partially_refunded"
        ? row.payment_status
        : "not_required",
    fiscal_status:
      row.fiscal_status === "pending" ||
      row.fiscal_status === "issued" ||
      row.fiscal_status === "failed" ||
      row.fiscal_status === "refunded"
        ? row.fiscal_status
        : "not_required",
    fulfillment_mode: row.fulfillment_mode === "scheduled" ? "scheduled" : "asap",
    requested_at: typeof row.requested_at === "string" ? row.requested_at : null,
    kitchen_started_at: typeof row.kitchen_started_at === "string" ? row.kitchen_started_at : null,
    kitchen_completed_at: typeof row.kitchen_completed_at === "string" ? row.kitchen_completed_at : null,
    assigned_staff_id: assignedStaffId,
    assigned_staff_name: assignedStaffId ? staffNames.get(assignedStaffId) ?? null : null,
    total: Number(row.total ?? 0),
    is_test: Boolean(row.is_test),
    is_operational: Boolean(row.is_operational),
    items,
    payments
  };
}

function normalizeItem(
  row: Record<string, unknown>,
  modifiers: AdminOrderItemModifier[]
): AdminOrderItem {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    product_id: row.product_id ? String(row.product_id) : null,
    product_name: String(row.product_name ?? ""),
    unit_price: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    line_total: Number(row.line_total ?? 0),
    item_note: typeof row.item_note === "string" ? row.item_note : null,
    modifiers
  };
}

function normalizeModifier(row: Record<string, unknown>): AdminOrderItemModifier {
  return {
    id: String(row.id),
    modifier_type: row.modifier_type === "add" || row.modifier_type === "replace" ? row.modifier_type : "remove",
    ingredient_name: String(row.ingredient_name ?? ""),
    quantity: Number(row.quantity ?? 0),
    unit: String(row.unit ?? ""),
    line_price_delta: Number(row.line_price_delta ?? 0)
  };
}

function moneyMinorUnits(value: unknown) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? "0"));
  if (!match) return BigInt(0);
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

function normalizeFiscalItems(value: unknown): AdminFiscalReceiptItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const request = (value as { request?: unknown }).request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return [];
  const items = (request as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((rawItem) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return [];
    const item = rawItem as Record<string, unknown>;
    const amount = item.amount;
    const amountValue = amount && typeof amount === "object" && !Array.isArray(amount)
      ? (amount as { value?: unknown }).value
      : null;
    if (typeof item.description !== "string" || typeof amountValue !== "string") return [];
    return [{
      amount: amountValue,
      description: item.description,
      payment_mode: typeof item.payment_mode === "string" ? item.payment_mode : "unknown",
      payment_subject: typeof item.payment_subject === "string" ? item.payment_subject : "unknown",
      quantity: Number(item.quantity ?? 0),
      vat_code: Number(item.vat_code ?? 0)
    }];
  });
}

export async function getAdminOrders(locationIds: string[] | null = null) {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: true,
      error: null as string | null
    };
  }

  if (locationIds !== null && !locationIds.length) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: null as string | null
    };
  }

  let ordersQuery = database
    .from("orders")
    .select("id, created_at, customer_name, customer_phone, display_number, source, kitchen_status, delivery_type, address, comment, status, payment_status, fiscal_status, fulfillment_mode, requested_at, kitchen_started_at, kitchen_completed_at, assigned_staff_id, total, is_test, is_operational");
  if (locationIds !== null) ordersQuery = ordersQuery.in("location_id", locationIds);
  const { data: ordersData, error: ordersError } = await ordersQuery.order("created_at", { ascending: false });

  if (ordersError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: formatMissingTableError(ordersError.message, "orders")
    };
  }

  const orderIds = (ordersData ?? []).map((order) => String(order.id));

  if (!orderIds.length) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: null as string | null
    };
  }

  const [
    { data: itemsData, error: itemsError },
    { data: staffData },
    { data: paymentsData, error: paymentsError }
  ] =
    await Promise.all([
      database
        .from("order_items")
        .select("id, order_id, product_id, product_name, unit_price, quantity, line_total, item_note")
        .in("order_id", orderIds),
      database.from("staff_users").select("id, name"),
      database
        .from("payments")
        .select("id, order_id, provider, provider_payment_id, status, provider_status, amount, currency, payment_method, receipt_registration, refundable_amount, created_at, paid_at")
        .in("order_id", orderIds)
    ]);

  if (itemsError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: formatMissingTableError(itemsError.message, "order_items")
    };
  }
  if (paymentsError) {
    return {
      orders: [] as AdminOrder[],
      notConfigured: false,
      error: formatMissingTableError(paymentsError.message, "payments")
    };
  }

  const paymentIds = (paymentsData ?? []).map((payment) => String(payment.id));
  const [{ data: refundsData }, { data: receiptsData }] = paymentIds.length
    ? await Promise.all([
        database
          .from("refunds")
          .select("id, payment_id, provider_refund_id, status, provider_status, amount, receipt_registration, created_at, completed_at")
          .in("payment_id", paymentIds),
        database
          .from("fiscal_receipts")
          .select("id, payment_id, provider_receipt_id, provider_status, receipt_type, status, receipt_phase, receipt_registration, amount, payload, last_error_code, created_at, fiscalized_at")
          .in("payment_id", paymentIds)
      ])
    : [{ data: [] }, { data: [] }];

  const refundsByPayment = new Map<string, AdminRefund[]>();
  for (const refund of refundsData ?? []) {
    const paymentId = String(refund.payment_id);
    refundsByPayment.set(paymentId, [
      ...(refundsByPayment.get(paymentId) ?? []),
      {
        amount: String(refund.amount ?? "0"),
        completed_at: refund.completed_at ? String(refund.completed_at) : null,
        created_at: String(refund.created_at),
        id: String(refund.id),
        provider_refund_id: refund.provider_refund_id ? String(refund.provider_refund_id) : null,
        provider_status: refund.provider_status ? String(refund.provider_status) : null,
        receipt_registration: refund.receipt_registration ? String(refund.receipt_registration) : null,
        status: String(refund.status)
      }
    ]);
  }

  const receiptsByPayment = new Map<string, AdminFiscalReceipt[]>();
  for (const receipt of receiptsData ?? []) {
    const paymentId = String(receipt.payment_id);
    receiptsByPayment.set(paymentId, [
      ...(receiptsByPayment.get(paymentId) ?? []),
      {
        amount: String(receipt.amount ?? "0"),
        created_at: String(receipt.created_at),
        fiscalized_at: receipt.fiscalized_at ? String(receipt.fiscalized_at) : null,
        id: String(receipt.id),
        items: normalizeFiscalItems(receipt.payload),
        last_error_code: receipt.last_error_code ? String(receipt.last_error_code) : null,
        provider_status: receipt.provider_status ? String(receipt.provider_status) : null,
        provider_receipt_id: receipt.provider_receipt_id ? String(receipt.provider_receipt_id) : null,
        receipt_phase: String(receipt.receipt_phase),
        receipt_registration: receipt.receipt_registration ? String(receipt.receipt_registration) : null,
        receipt_type: String(receipt.receipt_type),
        status: String(receipt.status)
      }
    ]);
  }

  const paymentsByOrder = new Map<string, AdminPayment[]>();
  for (const payment of paymentsData ?? []) {
    const paymentId = String(payment.id);
    const orderId = String(payment.order_id);
    const paymentRefunds = refundsByPayment.get(paymentId) ?? [];
    const refundedMinor = paymentRefunds
      .filter((refund) => refund.status === "completed")
      .reduce((total, refund) => total + moneyMinorUnits(refund.amount), BigInt(0));
    const paymentMinor = moneyMinorUnits(payment.amount);
    const effectiveStatus = refundedMinor >= paymentMinor && paymentMinor > BigInt(0)
      ? "refunded"
      : refundedMinor > BigInt(0)
        ? "partially_refunded"
        : String(payment.status);
    paymentsByOrder.set(orderId, [
      ...(paymentsByOrder.get(orderId) ?? []),
      {
        amount: String(payment.amount ?? "0"),
        created_at: String(payment.created_at),
        currency: String(payment.currency ?? "RUB"),
        fiscal_receipts: receiptsByPayment.get(paymentId) ?? [],
        id: paymentId,
        paid_at: payment.paid_at ? String(payment.paid_at) : null,
        payment_method: payment.payment_method ? String(payment.payment_method) : null,
        provider: String(payment.provider),
        provider_payment_id: payment.provider_payment_id ? String(payment.provider_payment_id) : null,
        provider_status: payment.provider_status ? String(payment.provider_status) : null,
        receipt_registration: payment.receipt_registration ? String(payment.receipt_registration) : null,
        refundable_amount: String(payment.refundable_amount ?? "0"),
        refunds: paymentRefunds,
        status: effectiveStatus
      }
    ]);
  }

  const itemIds = (itemsData ?? []).map((item) => String(item.id));
  let resolvedModifiers: Record<string, unknown>[] = [];

  if (itemIds.length) {
    const { data } = await database
      .from("order_item_modifiers")
      .select("id, order_item_id, modifier_type, ingredient_name, quantity, unit, line_price_delta")
      .in("order_item_id", itemIds);
    resolvedModifiers = data ?? [];
  }

  const modifiersByItem = new Map<string, AdminOrderItemModifier[]>();
  for (const modifierRow of resolvedModifiers) {
    const itemId = String(modifierRow.order_item_id);
    modifiersByItem.set(itemId, [
      ...(modifiersByItem.get(itemId) ?? []),
      normalizeModifier(modifierRow)
    ]);
  }

  const staffNames = new Map((staffData ?? []).map((staff) => [String(staff.id), String(staff.name)]));
  const items = (itemsData ?? []).map((item) =>
    normalizeItem(item, modifiersByItem.get(String(item.id)) ?? [])
  );
  const orders = (ordersData ?? []).map((order) =>
    normalizeOrder(
      order,
      items.filter((item) => item.order_id === String(order.id)),
      staffNames,
      paymentsByOrder.get(String(order.id)) ?? []
    )
  );

  return {
    orders,
    notConfigured: false,
    error: null as string | null
  };
}
