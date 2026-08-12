import "server-only";

import type { EvotorDocument, EvotorReceipt } from "./types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown) {
  return value === null || value === undefined || value === "" ? null : String(value).slice(0, 255);
}

const excludedKeys = new Set([
  "authorization",
  "addresses",
  "cashless_info",
  "client_email",
  "client_phone",
  "counterparties",
  "customer_email",
  "customer_phone",
  "email",
  "emails",
  "imei",
  "inn",
  "kkt_serial_number",
  "kpp",
  "phone",
  "phones",
  "serial_number",
  "token"
]);

export function sanitizeEvotorPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEvotorPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .filter(([key]) => !excludedKeys.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizeEvotorPayload(item)])
  );
}

function fiscalRecord(body: UnknownRecord) {
  const candidate = body.pos_print_results ?? body.fiscal_data ?? body.fiscalData ?? body.fiscal;
  if (Array.isArray(candidate)) return asRecord(candidate[0]);
  return asRecord(candidate);
}

export function parseEvotorReceipt(document: EvotorDocument): EvotorReceipt | null {
  const receiptType = document.type === "SELL"
    ? "sale"
    : document.type === "PAYBACK"
      ? "return"
      : document.type === "CORRECTION"
        ? "correction"
        : null;
  if (!receiptType) return null;

  const body = asRecord(document.body);
  const positions = Array.isArray(body.positions) ? body.positions : [];
  const items = positions.map((value, index) => {
    const position = asRecord(value);
    const quantity = Math.abs(asNumber(position.quantity));
    const unitPrice = asNumber(position.result_price ?? position.price);
    const lineTotal = Math.abs(asNumber(position.result_sum)) || quantity * unitPrice;
    const positionDiscount = Math.abs(asNumber(position.position_discount ?? position.discount));
    const productId = asText(position.product_id);
    const sourceKey = asText(position.id ?? position.position_id ?? position.uuid)
      ?? `${productId ?? "item"}:${index}`;

    return {
      sourceKey,
      productId,
      name: asText(position.name ?? position.product_name ?? position.code) ?? `Позиция ${index + 1}`,
      quantity,
      unitPrice,
      discount: positionDiscount,
      lineTotal,
      tax: asText(position.tax),
      raw: sanitizeEvotorPayload(position) as UnknownRecord
    };
  });
  const positionsTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = Math.abs(asNumber(body.result_sum ?? body.sum)) || positionsTotal;
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal + item.discount, 0) || total;
  const payments = (Array.isArray(body.payments) ? body.payments : []).map((value) => {
    const payment = asRecord(value);
    return {
      type: asText(payment.type ?? payment.payment_type) ?? "UNKNOWN",
      sum: Math.abs(asNumber(payment.sum ?? payment.value))
    };
  });
  const fiscal = fiscalRecord(body);

  return {
    externalId: document.id,
    type: receiptType,
    number: asText(document.number),
    employeeId: asText(document.employee_id ?? document.close_user_id ?? body.employee_id),
    closedAt: asText(document.close_date),
    subtotal,
    discount: Math.max(0, subtotal - total),
    total,
    payments,
    fiscalDocumentNumber: asText(fiscal.fiscal_document_number ?? fiscal.document_number),
    fiscalDriveNumber: asText(fiscal.fiscal_drive_number ?? fiscal.fn_number ?? fiscal.fn_serial_number),
    fiscalSign: asText(fiscal.fiscal_sign ?? fiscal.fiscal_document_sign ?? fiscal.fiscal_sign_doc_number),
    items,
    raw: sanitizeEvotorPayload({
      type: document.type,
      number: document.number,
      close_date: document.close_date,
      device_id: document.device_id,
      store_id: document.store_id,
      body
    }) as UnknownRecord
  };
}
