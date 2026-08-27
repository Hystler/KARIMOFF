import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { minorUnitsToMoney, moneyToMinorUnits } from "./money";
import type { FiscalOrderItem, FiscalOrderModifier } from "./receipt";
import { yooKassaReconciliationDelaySeconds } from "./retry";
import type { YooKassaPayment, YooKassaProviderReceipt, YooKassaRefund } from "./types";

type PaymentContextRow = {
  amount: string;
  confirmation_url: string | null;
  created_at: string;
  customer_id: string | null;
  display_number: string | null;
  id: string;
  idempotency_key: string;
  kitchen_status: string;
  order_id: string;
  provider_payment_id: string | null;
  receipt_email: string;
  receipt_registration: string | null;
  request_fingerprint: string | null;
  status: string;
};

type OrderItemRow = {
  id: string;
  line_total: string;
  product_name: string;
  quantity: number | string;
  unit_price: string;
};

type ModifierRow = {
  ingredient_name: string;
  modifier_type: "add" | "remove" | "replace";
  order_item_id: string;
};

export type YooKassaPaymentContext = {
  amount: string;
  confirmationUrl: string | null;
  createdAt: string;
  customerId: string | null;
  displayNumber: string;
  id: string;
  idempotencyKey: string;
  items: FiscalOrderItem[];
  kitchenStatus: string;
  orderId: string;
  providerPaymentId: string | null;
  receiptEmail: string;
  receiptRegistration: string | null;
  requestFingerprint: string | null;
  status: string;
};

export type CustomerPaymentStatus = {
  displayNumber: string;
  fiscalStatus: string;
  orderId: string;
  paymentId: string;
  paymentStatus: string;
  providerStatus: string | null;
  receiptRegistration: string | null;
};

export type FiscalReceiptContext = {
  amount: string;
  id: string;
  idempotencyKey: string;
  items: FiscalOrderItem[];
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  providerReceiptId: string | null;
  receiptEmail: string;
};

export type YooKassaRefundAllocation = {
  orderItemId: string;
  quantity: number;
};

export type YooKassaRefundContext = {
  amount: string;
  handedOut: boolean;
  id: string;
  idempotencyKey: string;
  isFullRefund: boolean;
  items: FiscalOrderItem[];
  orderId: string;
  originalPaymentAmount: string;
  paymentId: string;
  providerPaymentId: string;
  providerRefundId: string | null;
  receiptEmail: string;
  receiptRegistration: string | null;
  status: string;
};

function normalizeItems(rows: OrderItemRow[], modifiers: ModifierRow[]) {
  const modifiersByItem = new Map<string, FiscalOrderModifier[]>();
  for (const modifier of modifiers) {
    modifiersByItem.set(modifier.order_item_id, [
      ...(modifiersByItem.get(modifier.order_item_id) ?? []),
      {
        ingredientName: modifier.ingredient_name,
        modifierType: modifier.modifier_type
      }
    ]);
  }
  return rows.map((item) => ({
    lineTotal: item.line_total,
    modifiers: modifiersByItem.get(item.id) ?? [],
    productName: item.product_name,
    quantity: Number(item.quantity),
    unitPrice: item.unit_price
  }));
}

async function loadOrderItems(orderId: string) {
  const sql = getPostgresSql();
  const items = await sql<OrderItemRow[]>`
    select
      id,
      product_name,
      quantity,
      unit_price::text as unit_price,
      line_total::text as line_total
    from public.order_items
    where order_id = ${orderId}::uuid
    order by created_at, id
  `;
  const itemIds = items.map((item) => item.id);
  const modifiers = itemIds.length
    ? await sql<ModifierRow[]>`
        select order_item_id, modifier_type, ingredient_name
        from public.order_item_modifiers
        where order_item_id = any(${itemIds}::uuid[])
        order by created_at, id
      `
    : [];
  return normalizeItems(items, modifiers);
}

async function loadSettlementItems(orderId: string, includedRefundIds: string[]) {
  const sql = getPostgresSql();
  const items = await sql<OrderItemRow[]>`
    with refunded as (
      select refund_item.order_item_id, sum(refund_item.quantity)::numeric as quantity
      from public.refund_items refund_item
      join public.refunds refund on refund.id = refund_item.refund_id
      where refund.order_id = ${orderId}::uuid
        and refund.provider = 'yookassa'
        and refund.status = 'completed'
        and refund.id = any(${includedRefundIds}::uuid[])
      group by refund_item.order_item_id
    )
    select
      item.id,
      item.product_name,
      (item.quantity - coalesce(refunded.quantity, 0))::text as quantity,
      item.unit_price::text as unit_price,
      (item.unit_price * (item.quantity - coalesce(refunded.quantity, 0)))::text as line_total
    from public.order_items item
    left join refunded on refunded.order_item_id = item.id
    where item.order_id = ${orderId}::uuid
      and item.quantity - coalesce(refunded.quantity, 0) > 0
    order by item.created_at, item.id
  `;
  const itemIds = items.map((item) => item.id);
  const modifiers = itemIds.length
    ? await sql<ModifierRow[]>`
        select order_item_id, modifier_type, ingredient_name
        from public.order_item_modifiers
        where order_item_id = any(${itemIds}::uuid[])
        order by created_at, id
      `
    : [];
  return normalizeItems(items, modifiers);
}

export async function getYooKassaPaymentContext(paymentId: string) {
  const sql = getPostgresSql();
  const [row] = await sql<PaymentContextRow[]>`
    select
      p.id,
      p.order_id,
      p.idempotency_key,
      p.status,
      p.amount::text as amount,
      p.provider_payment_id,
      p.confirmation_url,
      p.receipt_email,
      p.receipt_registration,
      p.request_fingerprint,
      p.created_at,
      o.customer_id,
      o.display_number,
      o.kitchen_status
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.id = ${paymentId}::uuid
      and p.provider = 'yookassa'
    limit 1
  `;
  if (!row) return null;
  return {
    amount: row.amount,
    confirmationUrl: row.confirmation_url,
    createdAt: row.created_at,
    customerId: row.customer_id,
    displayNumber: row.display_number || row.order_id.slice(0, 8),
    id: row.id,
    idempotencyKey: row.idempotency_key,
    items: await loadOrderItems(row.order_id),
    kitchenStatus: row.kitchen_status,
    orderId: row.order_id,
    providerPaymentId: row.provider_payment_id,
    receiptEmail: row.receipt_email,
    receiptRegistration: row.receipt_registration,
    requestFingerprint: row.request_fingerprint,
    status: row.status
  } satisfies YooKassaPaymentContext;
}

export async function bindPaymentRequestFingerprint(paymentId: string, fingerprint: string) {
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const [payment] = await transaction<{
      provider_payment_id: string | null;
      request_fingerprint: string | null;
    }[]>`
      select request_fingerprint, provider_payment_id
      from public.payments
      where id = ${paymentId}::uuid and provider = 'yookassa'
      for update
    `;
    if (!payment) throw new Error("YOOKASSA_PAYMENT_NOT_FOUND");
    if (payment.request_fingerprint && payment.request_fingerprint !== fingerprint) {
      throw new Error("YOOKASSA_REQUEST_FINGERPRINT_MISMATCH");
    }
    if (!payment.request_fingerprint) {
      await transaction`
        update public.payments
        set request_fingerprint = ${fingerprint}, updated_at = now()
        where id = ${paymentId}::uuid
      `;
    }
    return payment.provider_payment_id;
  });
}

export async function recordYooKassaPaymentCreated(paymentId: string, payment: YooKassaPayment) {
  const sql = getPostgresSql();
  const confirmationUrl = payment.confirmation?.confirmation_url ?? null;
  await sql`
    update public.payments
    set provider_payment_id = ${payment.id},
        confirmation_url = ${confirmationUrl},
        provider_status = ${payment.status},
        provider_created_at = coalesce(provider_created_at, ${payment.created_at ?? null}::timestamptz),
        updated_at = now()
    where id = ${paymentId}::uuid
      and provider = 'yookassa'
      and (provider_payment_id is null or provider_payment_id = ${payment.id})
  `;
}

export async function applyYooKassaPaymentState(paymentId: string, payment: YooKassaPayment) {
  const sql = getPostgresSql();
  const refunded = moneyToMinorUnits(payment.refunded_amount?.value ?? "0.00");
  const refundableAmount = payment.refundable
    ? moneyToMinorUnits(payment.amount.value) - refunded
    : BigInt(0);
  const normalizedRefundable = minorUnitsToMoney(
    refundableAmount > BigInt(0) ? refundableAmount : BigInt(0)
  );
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select public.apply_yookassa_payment_state(
      ${paymentId}::uuid,
      ${payment.id},
      ${payment.status},
      ${payment.paid},
      ${payment.amount.value}::numeric,
      ${payment.amount.currency},
      ${payment.receipt_registration ?? null},
      ${payment.payment_method?.type ?? null},
      ${normalizedRefundable}::numeric,
      ${payment.created_at ?? null}::timestamptz,
      ${payment.captured_at ?? null}::timestamptz
    ) as result
  `;
  return rows[0]?.result ?? null;
}

export async function markYooKassaPaymentFailure(params: {
  errorCode: string;
  paymentId: string;
  random?: number;
  retryable: boolean;
}) {
  const sql = getPostgresSql();
  const [row] = await sql<{ attempts: number; created_at: string }[]>`
    select reconcile_attempts + 1 as attempts, created_at
    from public.payments
    where id = ${params.paymentId}::uuid and provider = 'yookassa'
  `;
  if (!row) return;
  const delay = params.retryable
    ? yooKassaReconciliationDelaySeconds({
        ageSeconds: Math.max(0, (Date.now() - new Date(row.created_at).getTime()) / 1000),
        attempts: row.attempts,
        random: params.random,
        transientFailure: true
      })
    : null;
  const nextAt = delay === null ? null : new Date(Date.now() + delay * 1000);
  await sql`
    update public.payments
    set reconcile_attempts = ${row.attempts},
        next_reconcile_at = ${nextAt},
        last_error_code = ${params.errorCode.slice(0, 120)},
        last_error_at = now(),
        reconcile_locked_at = null,
        reconcile_locked_by = null,
        updated_at = now()
    where id = ${params.paymentId}::uuid and provider = 'yookassa'
  `;
}

export async function claimDueYooKassaPayments(workerId: string, limit: number) {
  const sql = getPostgresSql();
  const rows = await sql<{ id: string }[]>`
    with due as (
      select id
      from public.payments
      where provider = 'yookassa'
        and (status = 'pending' or receipt_registration = 'pending')
        and next_reconcile_at is not null
        and next_reconcile_at <= now()
        and (reconcile_until is null or reconcile_until > now())
        and (reconcile_locked_at is null or reconcile_locked_at < now() - interval '2 minutes')
      order by next_reconcile_at, created_at
      for update skip locked
      limit ${Math.max(1, Math.min(25, limit))}
    )
    update public.payments payment
    set reconcile_locked_at = now(), reconcile_locked_by = ${workerId}
    from due
    where payment.id = due.id
    returning payment.id
  `;
  return rows.map((row) => row.id);
}

export async function getCustomerPaymentStatus(paymentId: string, customerId: string) {
  const sql = getPostgresSql();
  const [row] = await sql<{
    display_number: string | null;
    fiscal_status: string;
    order_id: string;
    payment_id: string;
    payment_status: string;
    provider_status: string | null;
    receipt_registration: string | null;
  }[]>`
    select
      p.id as payment_id,
      p.status as payment_status,
      p.provider_status,
      p.receipt_registration,
      o.id as order_id,
      o.display_number,
      o.fiscal_status
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.id = ${paymentId}::uuid
      and p.provider = 'yookassa'
      and o.customer_id = ${customerId}::uuid
    limit 1
  `;
  if (!row) return null;
  return {
    displayNumber: row.display_number || row.order_id.slice(0, 8),
    fiscalStatus: row.fiscal_status,
    orderId: row.order_id,
    paymentId: row.payment_id,
    paymentStatus: row.payment_status,
    providerStatus: row.provider_status,
    receiptRegistration: row.receipt_registration
  } satisfies CustomerPaymentStatus;
}

export async function findInternalPaymentId(payment: YooKassaPayment) {
  const sql = getPostgresSql();
  const metadataPaymentId = payment.metadata?.payment_id;
  const [row] = metadataPaymentId && /^[0-9a-f-]{36}$/i.test(metadataPaymentId)
    ? await sql<{ id: string }[]>`
        select id from public.payments
        where id = ${metadataPaymentId}::uuid and provider = 'yookassa'
        limit 1
      `
    : await sql<{ id: string }[]>`
        select id from public.payments
        where provider = 'yookassa' and provider_payment_id = ${payment.id}
        limit 1
      `;
  return row?.id ?? null;
}

export async function insertPaymentEvent(params: {
  eventId: string;
  eventType: string;
  objectId: string;
  paymentId: string | null;
}) {
  const sql = getPostgresSql();
  const [row] = await sql<{ id: string; processed_at: string | null }[]>`
    insert into public.payment_events (
      payment_id, provider, provider_event_id, event_type, payload
    ) values (
      ${params.paymentId}::uuid,
      'yookassa',
      ${params.eventId},
      ${params.eventType},
      ${sql.json({ object_id: params.objectId })}
    )
    on conflict (provider, provider_event_id)
      where provider_event_id is not null
    do update set provider_event_id = excluded.provider_event_id
    returning id, processed_at
  `;
  return row;
}

export async function finishPaymentEvent(eventId: string, params: {
  errorCode?: string | null;
  paymentId?: string | null;
  processed?: boolean;
  verified: boolean;
}) {
  const sql = getPostgresSql();
  await sql`
    update public.payment_events
    set payment_id = coalesce(${params.paymentId ?? null}::uuid, payment_id),
        signature_verified = ${params.verified},
        processed_at = case when ${params.processed ?? !params.errorCode} then now() else processed_at end,
        processing_error = ${params.errorCode?.slice(0, 120) ?? null}
    where provider = 'yookassa' and provider_event_id = ${eventId}
  `;
}

export async function claimDueFiscalReceipts(workerId: string, limit: number) {
  const sql = getPostgresSql();
  const rows = await sql<{ id: string }[]>`
    with due as (
      select id
      from public.fiscal_receipts
      where provider = 'yookassa'
        and receipt_phase = 'prepayment_settlement'
        and status = 'pending'
        and next_reconcile_at is not null
        and next_reconcile_at <= now()
        and (reconcile_until is null or reconcile_until > now())
        and (reconcile_locked_at is null or reconcile_locked_at < now() - interval '2 minutes')
      order by next_reconcile_at, created_at
      for update skip locked
      limit ${Math.max(1, Math.min(25, limit))}
    )
    update public.fiscal_receipts receipt
    set reconcile_locked_at = now(), reconcile_locked_by = ${workerId}
    from due
    where receipt.id = due.id
    returning receipt.id
  `;
  return rows.map((row) => row.id);
}

export async function getFiscalReceiptContext(receiptId: string) {
  const sql = getPostgresSql();
  const [row] = await sql<{
    amount: string;
    id: string;
    idempotency_key: string;
    order_id: string;
    payment_id: string;
    payload: { included_refund_ids?: unknown } | null;
    provider_payment_id: string;
    provider_receipt_id: string | null;
    receipt_email: string;
  }[]>`
    select
      receipt.id,
      receipt.order_id,
      receipt.payment_id,
      receipt.idempotency_key,
      receipt.amount::text as amount,
      receipt.payload,
      receipt.provider_receipt_id,
      payment.provider_payment_id,
      payment.receipt_email
    from public.fiscal_receipts receipt
    join public.payments payment on payment.id = receipt.payment_id
    where receipt.id = ${receiptId}::uuid
      and receipt.provider = 'yookassa'
      and receipt.receipt_phase = 'prepayment_settlement'
    limit 1
  `;
  if (!row?.provider_payment_id) return null;
  const includedRefundIds = Array.isArray(row.payload?.included_refund_ids)
    ? row.payload.included_refund_ids.filter(
        (value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
      ).slice(0, 100)
    : [];
  return {
    amount: row.amount,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    items: await loadSettlementItems(row.order_id, includedRefundIds),
    orderId: row.order_id,
    paymentId: row.payment_id,
    providerPaymentId: row.provider_payment_id,
    providerReceiptId: row.provider_receipt_id,
    receiptEmail: row.receipt_email
  } satisfies FiscalReceiptContext;
}

export async function bindFiscalReceiptRequestFingerprint(
  receiptId: string,
  fingerprint: string
) {
  const sql = getPostgresSql();
  await sql.begin(async (transaction) => {
    const [receipt] = await transaction<{ request_fingerprint: string | null }[]>`
      select request_fingerprint
      from public.fiscal_receipts
      where id = ${receiptId}::uuid and provider = 'yookassa'
      for update
    `;
    if (!receipt) throw new Error("YOOKASSA_FISCAL_RECEIPT_NOT_FOUND");
    if (receipt.request_fingerprint && receipt.request_fingerprint !== fingerprint) {
      throw new Error("YOOKASSA_FISCAL_RECEIPT_FINGERPRINT_MISMATCH");
    }
    if (!receipt.request_fingerprint) {
      await transaction`
        update public.fiscal_receipts
        set request_fingerprint = ${fingerprint}, updated_at = now()
        where id = ${receiptId}::uuid
      `;
    }
  });
}

export async function recordFiscalReceiptState(
  receiptId: string,
  receipt: YooKassaProviderReceipt
) {
  const sql = getPostgresSql();
  const status = receipt.status === "succeeded" ? "issued" : receipt.status === "canceled" ? "failed" : "pending";
  const nextAt = receipt.status === "pending" ? new Date(Date.now() + 30_000) : null;
  await sql.begin(async (transaction) => {
    const [row] = await transaction<{ order_id: string }[]>`
      update public.fiscal_receipts
      set provider_receipt_id = ${receipt.id},
          provider_status = ${receipt.status},
          receipt_registration = ${receipt.status},
          status = ${status},
          fiscalized_at = case when ${receipt.status} = 'succeeded' then coalesce(fiscalized_at, ${receipt.registered_at ?? null}::timestamptz, now()) else fiscalized_at end,
          reconcile_attempts = 0,
          next_reconcile_at = ${nextAt},
          last_reconciled_at = now(),
          last_error_code = null,
          last_error_at = null,
          reconcile_locked_at = null,
          reconcile_locked_by = null,
          updated_at = now()
      where id = ${receiptId}::uuid and provider = 'yookassa'
      returning order_id
    `;
    if (row) {
      await transaction`
        select public.refresh_yookassa_order_fiscal_status(${row.order_id}::uuid)
      `;
    }
  });
}

export async function markFiscalReceiptFailure(receiptId: string, errorCode: string) {
  const sql = getPostgresSql();
  await sql`
    update public.fiscal_receipts
    set reconcile_attempts = reconcile_attempts + 1,
        next_reconcile_at = now() + least(interval '15 minutes', interval '10 seconds' * power(2, least(7, reconcile_attempts))),
        last_error_code = ${errorCode.slice(0, 120)},
        last_error_at = now(),
        reconcile_locked_at = null,
        reconcile_locked_by = null,
        updated_at = now()
    where id = ${receiptId}::uuid and provider = 'yookassa'
  `;
}

export async function createYooKassaRefundAttempt(params: {
  allocations?: YooKassaRefundAllocation[];
  amount: string;
  createdByStaffId: string;
  idempotencyKey: string;
  paymentId: string;
  reason: string;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(params.paymentId)) throw new Error("INVALID_PAYMENT_ID");
  if (!/^[0-9A-Za-z+_.-]{1,64}$/.test(params.idempotencyKey)) {
    throw new Error("INVALID_REFUND_IDEMPOTENCY_KEY");
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.createdByStaffId)) {
    throw new Error("INVALID_REFUND_ACTOR");
  }
  const requestedMinor = moneyToMinorUnits(params.amount);
  if (requestedMinor <= BigInt(0)) throw new Error("INVALID_REFUND_AMOUNT");
  const amount = minorUnitsToMoney(requestedMinor);
  const reason = params.reason.trim().slice(0, 500);
  if (!reason) throw new Error("REFUND_REASON_REQUIRED");
  const allocationMap = new Map<string, number>();
  for (const allocation of params.allocations ?? []) {
    if (!/^[0-9a-f-]{36}$/i.test(allocation.orderItemId)) {
      throw new Error("INVALID_REFUND_ORDER_ITEM");
    }
    if (!Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0) {
      throw new Error("INVALID_REFUND_QUANTITY");
    }
    if (allocationMap.has(allocation.orderItemId)) throw new Error("DUPLICATE_REFUND_ORDER_ITEM");
    allocationMap.set(allocation.orderItemId, allocation.quantity);
  }

  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const [actor] = await transaction<{ id: string }[]>`
      select id
      from public.staff_users
      where id = ${params.createdByStaffId}::uuid
        and is_active = true
        and role in ('owner', 'admin')
      for share
    `;
    if (!actor) throw new Error("REFUND_ACTOR_NOT_AUTHORIZED");

    const [payment] = await transaction<{
      amount: string;
      order_id: string;
      provider_payment_id: string | null;
      receipt_email: string;
      refundable_amount: string;
      status: string;
    }[]>`
      select
        amount::text as amount,
        order_id,
        provider_payment_id,
        receipt_email,
        refundable_amount::text as refundable_amount,
        status
      from public.payments
      where id = ${params.paymentId}::uuid and provider = 'yookassa'
      for update
    `;
    if (!payment?.provider_payment_id || !payment.receipt_email) {
      throw new Error("YOOKASSA_REFUND_PAYMENT_NOT_READY");
    }
    if (!['paid', 'partially_refunded'].includes(payment.status)) {
      throw new Error("YOOKASSA_REFUND_PAYMENT_NOT_REFUNDABLE");
    }

    const [existing] = await transaction<{
      amount: string;
      id: string;
      payment_id: string;
    }[]>`
      select id, payment_id, amount::text as amount
      from public.refunds
      where idempotency_key = ${params.idempotencyKey}
      for update
    `;
    if (existing) {
      if (
        existing.payment_id !== params.paymentId ||
        moneyToMinorUnits(existing.amount) !== requestedMinor
      ) {
        throw new Error("REFUND_IDEMPOTENCY_CONFLICT");
      }
      return existing.id;
    }

    const [reserved] = await transaction<{
      active_count: number;
      completed_count: number;
      pending_amount: string;
    }[]>`
      select
        coalesce(sum(amount) filter (where status = 'pending'), 0)::text as pending_amount,
        count(*) filter (where status in ('pending', 'completed'))::integer as active_count,
        count(*) filter (where status = 'completed')::integer as completed_count
      from public.refunds
      where payment_id = ${params.paymentId}::uuid
        and provider = 'yookassa'
        and status in ('pending', 'completed')
    `;
    const availableMinor = moneyToMinorUnits(payment.refundable_amount)
      - moneyToMinorUnits(reserved?.pending_amount ?? "0.00");
    if (requestedMinor > availableMinor || availableMinor <= BigInt(0)) {
      throw new Error("REFUND_AMOUNT_EXCEEDS_AVAILABLE");
    }

    const originalMinor = moneyToMinorUnits(payment.amount);
    const isFullRefund =
      requestedMinor === originalMinor && Number(reserved?.active_count ?? 0) === 0;
    let itemRows: Array<{
      id: string;
      product_name: string;
      quantity: number;
      unit_price: string;
    }> = [];

    if (!isFullRefund) {
      if (!allocationMap.size) throw new Error("PARTIAL_REFUND_ITEMS_REQUIRED");
      const orderItemIds = [...allocationMap.keys()];
      itemRows = await transaction<{
        id: string;
        product_name: string;
        quantity: number;
        unit_price: string;
      }[]>`
        select id, product_name, quantity, unit_price::text as unit_price
        from public.order_items
        where order_id = ${payment.order_id}::uuid
          and id = any(${orderItemIds}::uuid[])
        order by created_at, id
        for update
      `;
      if (itemRows.length !== allocationMap.size) throw new Error("REFUND_ORDER_ITEM_NOT_FOUND");

      const priorRows = await transaction<{ order_item_id: string; quantity: string }[]>`
        select item.order_item_id, coalesce(sum(item.quantity), 0)::text as quantity
        from public.refund_items item
        join public.refunds refund on refund.id = item.refund_id
        where refund.payment_id = ${params.paymentId}::uuid
          and refund.status in ('pending', 'completed')
          and item.order_item_id = any(${orderItemIds}::uuid[])
        group by item.order_item_id
      `;
      const priorByItem = new Map(
        priorRows.map((row) => [row.order_item_id, Number(row.quantity)])
      );
      let allocatedMinor = BigInt(0);
      for (const item of itemRows) {
        const quantity = allocationMap.get(item.id) ?? 0;
        const remaining = Number(item.quantity) - (priorByItem.get(item.id) ?? 0);
        if (quantity > remaining) throw new Error("REFUND_QUANTITY_EXCEEDS_AVAILABLE");
        allocatedMinor += moneyToMinorUnits(item.unit_price) * BigInt(quantity);
      }
      if (allocatedMinor !== requestedMinor) throw new Error("REFUND_ITEMS_TOTAL_MISMATCH");
    }

    const [refund] = await transaction<{ id: string }[]>`
      insert into public.refunds (
        payment_id,
        order_id,
        provider,
        idempotency_key,
        status,
        amount,
        reason,
        created_by_staff_id,
        next_reconcile_at,
        reconcile_until,
        metadata
      ) values (
        ${params.paymentId}::uuid,
        ${payment.order_id}::uuid,
        'yookassa',
        ${params.idempotencyKey},
        'pending',
        ${amount}::numeric,
        ${reason},
        ${params.createdByStaffId}::uuid,
        now() + interval '30 seconds',
        now() + interval '24 hours',
        ${transaction.json({ refund_kind: isFullRefund ? "full" : "partial" })}
      )
      returning id
    `;
    if (!refund) throw new Error("REFUND_ATTEMPT_NOT_CREATED");

    for (const item of itemRows) {
      const quantity = allocationMap.get(item.id) ?? 0;
      const lineAmount = minorUnitsToMoney(moneyToMinorUnits(item.unit_price) * BigInt(quantity));
      await transaction`
        insert into public.refund_items (
          refund_id,
          order_item_id,
          description_snapshot,
          quantity,
          unit_amount,
          amount
        ) values (
          ${refund.id}::uuid,
          ${item.id}::uuid,
          ${item.product_name},
          ${quantity}::numeric,
          ${item.unit_price}::numeric,
          ${lineAmount}::numeric
        )
      `;
    }

    await transaction`
      insert into public.fiscal_receipts (
        order_id,
        payment_id,
        refund_id,
        receipt_type,
        status,
        idempotency_key,
        amount,
        provider,
        receipt_phase,
        reconcile_until,
        payload
      ) values (
        ${payment.order_id}::uuid,
        ${params.paymentId}::uuid,
        ${refund.id}::uuid,
        'refund',
        'pending',
        ${`yookassa:refund:${refund.id}`},
        ${amount}::numeric,
        'yookassa',
        'refund',
        now() + interval '72 hours',
        ${transaction.json({ source: "refund.create" })}
      )
      on conflict (idempotency_key) do nothing
    `;
    return refund.id;
  });
}

async function loadRefundItems(refundId: string) {
  const sql = getPostgresSql();
  const rows = await sql<{
    amount: string;
    description_snapshot: string;
    order_item_id: string;
    quantity: string;
    unit_amount: string;
  }[]>`
    select
      order_item_id,
      description_snapshot,
      quantity::text as quantity,
      unit_amount::text as unit_amount,
      amount::text as amount
    from public.refund_items
    where refund_id = ${refundId}::uuid
    order by created_at, id
  `;
  const itemIds = rows.map((row) => row.order_item_id);
  const modifiers = itemIds.length
    ? await sql<ModifierRow[]>`
        select order_item_id, modifier_type, ingredient_name
        from public.order_item_modifiers
        where order_item_id = any(${itemIds}::uuid[])
        order by created_at, id
      `
    : [];
  const modifiersByItem = new Map<string, FiscalOrderModifier[]>();
  for (const modifier of modifiers) {
    modifiersByItem.set(modifier.order_item_id, [
      ...(modifiersByItem.get(modifier.order_item_id) ?? []),
      { ingredientName: modifier.ingredient_name, modifierType: modifier.modifier_type }
    ]);
  }
  return rows.map((row) => ({
    lineTotal: row.amount,
    modifiers: modifiersByItem.get(row.order_item_id) ?? [],
    productName: row.description_snapshot,
    quantity: Number(row.quantity),
    unitPrice: row.unit_amount
  } satisfies FiscalOrderItem));
}

export async function getYooKassaRefundContext(refundId: string) {
  const sql = getPostgresSql();
  const [row] = await sql<{
    amount: string;
    id: string;
    idempotency_key: string;
    kitchen_status: string;
    metadata: { refund_kind?: unknown } | null;
    order_id: string;
    original_payment_amount: string;
    payment_id: string;
    provider_payment_id: string | null;
    provider_refund_id: string | null;
    receipt_email: string;
    receipt_registration: string | null;
    status: string;
  }[]>`
    select
      refund.id,
      refund.payment_id,
      refund.order_id,
      refund.idempotency_key,
      refund.status,
      refund.amount::text as amount,
      refund.provider_refund_id,
      refund.receipt_registration,
      refund.metadata,
      payment.amount::text as original_payment_amount,
      payment.provider_payment_id,
      payment.receipt_email,
      order_row.kitchen_status
    from public.refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join public.orders order_row on order_row.id = refund.order_id
    where refund.id = ${refundId}::uuid and refund.provider = 'yookassa'
    limit 1
  `;
  if (!row?.provider_payment_id || !row.receipt_email) return null;
  const isFullRefund = row.metadata?.refund_kind === "full";
  return {
    amount: row.amount,
    handedOut: row.kitchen_status === "handed_out",
    id: row.id,
    idempotencyKey: row.idempotency_key,
    isFullRefund,
    items: isFullRefund ? [] : await loadRefundItems(row.id),
    orderId: row.order_id,
    originalPaymentAmount: row.original_payment_amount,
    paymentId: row.payment_id,
    providerPaymentId: row.provider_payment_id,
    providerRefundId: row.provider_refund_id,
    receiptEmail: row.receipt_email,
    receiptRegistration: row.receipt_registration,
    status: row.status
  } satisfies YooKassaRefundContext;
}

export async function bindRefundRequestFingerprint(refundId: string, fingerprint: string) {
  const sql = getPostgresSql();
  await sql.begin(async (transaction) => {
    const [refund] = await transaction<{ request_fingerprint: string | null }[]>`
      select request_fingerprint
      from public.refunds
      where id = ${refundId}::uuid and provider = 'yookassa'
      for update
    `;
    if (!refund) throw new Error("YOOKASSA_REFUND_NOT_FOUND");
    if (refund.request_fingerprint && refund.request_fingerprint !== fingerprint) {
      throw new Error("YOOKASSA_REFUND_FINGERPRINT_MISMATCH");
    }
    if (!refund.request_fingerprint) {
      await transaction`
        update public.refunds
        set request_fingerprint = ${fingerprint}, updated_at = now()
        where id = ${refundId}::uuid
      `;
    }
  });
}

export async function claimDueYooKassaRefunds(workerId: string, limit: number) {
  const sql = getPostgresSql();
  const rows = await sql<{ id: string }[]>`
    with due as (
      select id
      from public.refunds
      where provider = 'yookassa'
        and (status = 'pending' or receipt_registration = 'pending')
        and next_reconcile_at is not null
        and next_reconcile_at <= now()
        and (reconcile_until is null or reconcile_until > now())
        and (reconcile_locked_at is null or reconcile_locked_at < now() - interval '2 minutes')
      order by next_reconcile_at, created_at
      for update skip locked
      limit ${Math.max(1, Math.min(25, limit))}
    )
    update public.refunds refund
    set reconcile_locked_at = now(), reconcile_locked_by = ${workerId}
    from due
    where refund.id = due.id
    returning refund.id
  `;
  return rows.map((row) => row.id);
}

export async function markYooKassaRefundFailure(params: {
  errorCode: string;
  refundId: string;
  retryable: boolean;
}) {
  const sql = getPostgresSql();
  const [row] = await sql<{ attempts: number; created_at: string }[]>`
    select reconcile_attempts + 1 as attempts, created_at
    from public.refunds
    where id = ${params.refundId}::uuid and provider = 'yookassa'
  `;
  if (!row) return;
  const delay = params.retryable
    ? yooKassaReconciliationDelaySeconds({
        ageSeconds: Math.max(0, (Date.now() - new Date(row.created_at).getTime()) / 1000),
        attempts: row.attempts,
        transientFailure: true
      })
    : null;
  const nextAt = delay === null ? null : new Date(Date.now() + delay * 1000);
  await sql`
    update public.refunds
    set reconcile_attempts = ${row.attempts},
        next_reconcile_at = ${nextAt},
        last_error_code = ${params.errorCode.slice(0, 120)},
        last_error_at = now(),
        reconcile_locked_at = null,
        reconcile_locked_by = null,
        updated_at = now()
    where id = ${params.refundId}::uuid and provider = 'yookassa'
  `;
}

export async function findInternalRefundId(refund: YooKassaRefund) {
  const sql = getPostgresSql();
  const [row] = await sql<{ id: string }[]>`
    select id from public.refunds
    where provider = 'yookassa' and provider_refund_id = ${refund.id}
    limit 1
  `;
  return row?.id ?? null;
}

export async function applyYooKassaRefundState(refundId: string, refund: YooKassaRefund) {
  const sql = getPostgresSql();
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select public.apply_yookassa_refund_state(
      ${refundId}::uuid,
      ${refund.id},
      ${refund.status},
      ${refund.amount.value}::numeric,
      ${refund.amount.currency},
      ${refund.receipt_registration ?? null}
    ) as result
  `;
  return rows[0]?.result ?? null;
}
