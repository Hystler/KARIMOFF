import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { terminalBridgeReady } from "./terminal-bridge";

export type EvotorPosPaymentStatus =
  | "queued"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "unknown";

type PosPaymentSummary = {
  intentId: string;
  orderId: string;
  displayNumber: string | null;
  status: EvotorPosPaymentStatus;
  amount: number;
  createdAt: string;
  updatedAt: string;
  result: Record<string, unknown>;
  locationId: string;
  createdByStaffId: string | null;
};

type NewPosPayment = {
  locationId: string;
  customerId: string | null;
  customerName: string;
  comment: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    removed_ingredient_ids: string[];
    extras: Array<{ ingredient_id: string; quantity: number }>;
    modifier_option_ids: string[];
    note: string;
  }>;
  idempotencyKey: string;
  actorId: string | null;
  actorRole: string;
};

export class EvotorPosPaymentError extends Error {
  readonly code = "EVOTOR_POS_PAYMENT";
}

function paymentError(message: string) {
  return new EvotorPosPaymentError(message);
}

function asStatus(value: string): EvotorPosPaymentStatus {
  if (["queued", "processing", "paid", "failed", "cancelled", "unknown"].includes(value)) {
    return value as EvotorPosPaymentStatus;
  }
  return "unknown";
}

export async function createEvotorPosPayment(input: NewPosPayment) {
  if (!terminalBridgeReady()) throw paymentError("Связь с кассой Эвотор ещё не включена.");
  if (process.env.TEST_ORDER_MODE === "true") {
    throw paymentError("Оплата картой через терминал отключена в тестовом режиме.");
  }

  return getPostgresSql().begin(async (sql) => {
    const [existing] = await sql<{
      intent_id: string;
      order_id: string;
      display_number: string | null;
      status: string;
      amount: string | number;
      created_at: string;
      updated_at: string;
    }[]>`
      select intent.id as intent_id, intent.order_id, order_row.display_number,
             intent.status, intent.amount, intent.created_at, intent.updated_at
      from public.evotor_terminal_payment_intents intent
      join public.orders order_row on order_row.id = intent.order_id
      where intent.idempotency_key = ${input.idempotencyKey}::uuid
      for update of intent
    `;
    if (existing) {
      return {
        intentId: existing.intent_id,
        orderId: existing.order_id,
        displayNumber: existing.display_number,
        status: asStatus(existing.status),
        amount: Number(existing.amount)
      };
    }

    const [preexistingOrder] = await sql<{ id: string }[]>`
      select id from public.orders
      where idempotency_key = ${input.idempotencyKey}::uuid
      for update
    `;
    if (preexistingOrder) {
      throw paymentError("Заказ с этим ключом уже создан. Обновите страницу кассы перед повтором.");
    }

    const [device] = await sql<{ id: string }[]>`
      select id
      from public.evotor_terminal_devices
      where location_id = ${input.locationId}::uuid
        and revoked_at is null
        and token_hash is not null
        and last_seen_at >= now() - interval '90 seconds'
      order by last_seen_at desc, paired_at desc nulls last
      limit 1
      for update
    `;
    if (!device) throw paymentError("Терминал не на связи. Откройте приложение KARIMOFF Bridge на кассе и повторите.");

    const [busy] = await sql<{ id: string }[]>`
      select id from public.evotor_terminal_payment_intents
      where device_id = ${device.id}::uuid
        and status in ('queued', 'processing', 'unknown')
      limit 1
    `;
    if (busy) throw paymentError("На кассе уже есть заказ с незавершённой оплатой. Сначала проверьте терминал.");

    const [createdOrder] = await sql<{
      order_id: string;
      total: string | number;
      display_number: string | null;
    }[]>`
      select * from public.create_pos_order_atomic(
        ${input.locationId}::uuid,
        ${input.customerName},
        ${input.comment},
        ${sql.json(input.items)}::jsonb,
        ${input.idempotencyKey}::uuid,
        ${input.actorId}::uuid,
        ${input.actorRole}::text,
        'asap'::text,
        null::timestamptz
      )
    `;
    if (!createdOrder) throw paymentError("Не удалось создать заказ на кассе.");

    if (input.customerId) {
      const [customer] = await sql<{ name: string; phone: string | null }[]>`
        select name, phone from public.customers where id = ${input.customerId}::uuid
      `;
      if (!customer) throw new Error("Карта гостя не найдена.");
      await sql`
        update public.orders
        set customer_id = ${input.customerId}::uuid,
            customer_name = ${customer.name},
            customer_phone = ${customer.phone},
            public_display_name = ${customer.name},
            source_metadata = coalesce(source_metadata, '{}'::jsonb)
              || jsonb_build_object('loyalty_card_linked', true),
            updated_at = now()
        where id = ${createdOrder.order_id}::uuid
      `;
    }

    const orderItems = await sql<{
      product_name: string;
      quantity: number;
      unit_price: string | number;
      line_total: string | number;
      modifiers: string | null;
    }[]>`
      select item.product_name, item.quantity, item.unit_price, item.line_total,
             (
               select string_agg(
                 case when modifier.modifier_type = 'remove'
                   then 'без ' || modifier.ingredient_name
                   else '+ ' || modifier.ingredient_name
                 end,
                 ', ' order by modifier.created_at, modifier.id
               )
               from public.order_item_modifiers modifier
               where modifier.order_item_id = item.id
             ) as modifiers
      from public.order_items item
      where item.order_id = ${createdOrder.order_id}::uuid
        and item.item_type = 'food'
      order by item.id
    `;
    if (!orderItems.length) throw paymentError("Нельзя отправить на терминал пустой заказ.");

    const amount = Number(createdOrder.total);
    const itemTotal = orderItems.reduce((sum, item) => sum + Number(item.line_total), 0);
    if (!Number.isFinite(amount) || amount <= 0
      || Math.round(itemTotal * 100) !== Math.round(amount * 100)) {
      throw paymentError("Состав заказа не совпал с итоговой суммой. Проверьте заказ и повторите.");
    }

    const [payment] = await sql<{ id: string }[]>`
      insert into public.payments (
        order_id, provider, idempotency_key, status, amount, currency,
        metadata, refundable_amount, receipt_registration
      ) values (
        ${createdOrder.order_id}::uuid,
        'evotor',
        ${`evotor:pos:${input.idempotencyKey}`},
        'pending',
        ${amount},
        'RUB',
        ${sql.json({ terminalDeviceId: device.id, staffId: input.actorId, channel: "karimoff_pos" })}::jsonb,
        0,
        'pending'
      )
      returning id
    `;

    const payload = {
      schemaVersion: 1,
      orderId: createdOrder.order_id,
      displayNumber: createdOrder.display_number || createdOrder.order_id.slice(0, 8),
      total: amount,
      items: orderItems.map((item) => ({
        name: [item.product_name, item.modifiers].filter(Boolean).join(" · "),
        quantity: Number(item.quantity),
        unitPrice: String(item.unit_price),
        lineTotal: Number(item.line_total)
      }))
    };

    const [intent] = await sql<{ id: string; status: string }[]>`
      insert into public.evotor_terminal_payment_intents (
        device_id, order_id, payment_id, idempotency_key, amount, status,
        payload, created_by_staff_id
      ) values (
        ${device.id}::uuid,
        ${createdOrder.order_id}::uuid,
        ${payment.id}::uuid,
        ${input.idempotencyKey}::uuid,
        ${amount},
        'queued',
        ${sql.json(payload)}::jsonb,
        ${input.actorId}::uuid
      )
      returning id, status
    `;

    await sql`
      update public.orders
      set payment_status = 'pending',
          fiscal_status = 'pending',
          is_operational = true,
          operational_started_at = coalesce(operational_started_at, now()),
          source_metadata = coalesce(source_metadata, '{}'::jsonb)
            || jsonb_build_object(
              'payment_required', true,
              'payment_provider', 'evotor',
              'evotor_payment_intent_id', ${intent.id}::uuid,
              'created_by_staff_id', ${input.actorId}::uuid
            ),
          updated_at = now()
      where id = ${createdOrder.order_id}::uuid
    `;

    await sql`
      insert into public.fiscal_receipts (
        order_id, payment_id, receipt_type, status, idempotency_key,
        amount, provider, provider_status, receipt_registration, payload
      ) values (
        ${createdOrder.order_id}::uuid,
        ${payment.id}::uuid,
        'sale',
        'pending',
        ${`evotor:payment:${payment.id}`},
        ${amount},
        'evotor',
        'pending',
        'pending',
        ${sql.json({ terminalDeviceId: device.id, paymentIntentId: intent.id })}::jsonb
      )
    `;

    await sql`
      insert into public.payment_events (
        payment_id, provider, provider_event_id, event_type, signature_verified, payload, processed_at
      ) values (
        ${payment.id}::uuid,
        'evotor',
        ${`terminal:${intent.id}:queued`},
        'terminal_payment_queued',
        false,
        ${sql.json({ terminalDeviceId: device.id })}::jsonb,
        now()
      )
      on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
    `;

    return {
      intentId: intent.id,
      orderId: createdOrder.order_id,
      displayNumber: createdOrder.display_number,
      status: asStatus(intent.status),
      amount
    };
  });
}

export async function nextEvotorTerminalPayment(deviceId: string) {
  return getPostgresSql().begin(async (sql) => {
    const [job] = await sql<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload
      from public.evotor_terminal_payment_intents
      where device_id = ${deviceId}::uuid and status = 'queued'
      order by created_at
      limit 1
      for update skip locked
    `;
    if (!job) return null;
    await sql`
      update public.evotor_terminal_payment_intents
      set status = 'processing', delivered_at = coalesce(delivered_at, now()), updated_at = now(),
          result = result || jsonb_build_object('terminalReceivedAt', now())
      where id = ${job.id}::uuid
    `;
    return job;
  });
}

export async function recordEvotorTerminalPaymentResult(params: {
  deviceId: string;
  intentId: string;
  status: "paid" | "failed" | "cancelled" | "unknown";
  receiptReference?: string | null;
  details?: string | null;
  safeBeforePayment?: boolean;
}) {
  return getPostgresSql().begin(async (sql) => {
    const [intent] = await sql<{
      id: string;
      order_id: string;
      payment_id: string;
      device_id: string;
      status: string;
      result: Record<string, unknown>;
      display_number: string | null;
      created_by_staff_id: string | null;
    }[]>`
      select intent.id, intent.order_id, intent.payment_id, intent.device_id,
             intent.status, intent.result, order_row.display_number,
             intent.created_by_staff_id
      from public.evotor_terminal_payment_intents intent
      join public.orders order_row on order_row.id = intent.order_id
      where intent.id = ${params.intentId}::uuid
        and intent.device_id = ${params.deviceId}::uuid
      for update of intent
    `;
    if (!intent) return { accepted: false, status: "unknown" as const };

    const safeCancel = params.safeBeforePayment === true
      && ["failed", "cancelled"].includes(params.status);
    if (intent.status === "paid") return { accepted: true, status: "paid" as const };
    if (["failed", "cancelled"].includes(intent.status)) {
      return { accepted: true, status: asStatus(intent.status) };
    }
    if (intent.status !== "processing" && !(intent.status === "unknown"
      && (safeCancel || params.status === "paid" || params.status === "unknown"))) {
      return { accepted: false, status: asStatus(intent.status) };
    }

    let nextStatus = params.status;
    const receiptReference = params.receiptReference?.trim() || "";
    if (nextStatus === "paid" && !receiptReference) nextStatus = "unknown";
    if (["failed", "cancelled"].includes(nextStatus) && !safeCancel) nextStatus = "unknown";
    const details = (params.details || "").trim().slice(0, 300);
    const result = {
      ...intent.result,
      terminalResult: nextStatus,
      receiptReference: receiptReference.slice(0, 128) || null,
      details: details || null,
      safeBeforePayment: safeCancel,
      receivedAt: new Date().toISOString()
    };

    await sql`
      update public.evotor_terminal_payment_intents
      set status = ${nextStatus}, result = ${sql.json(result)}::jsonb,
          completed_at = case when ${nextStatus} in ('paid', 'failed', 'cancelled') then now() else completed_at end,
          updated_at = now()
      where id = ${intent.id}::uuid
    `;

    if (nextStatus === "paid") {
      await sql`
        update public.payments
        set status = 'paid', provider_status = 'succeeded', payment_method = 'card',
            receipt_registration = 'succeeded', paid_at = coalesce(paid_at, now()),
            captured_at = coalesce(captured_at, now()),
            metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
              terminalReceiptReference: receiptReference,
              terminalDeviceId: params.deviceId
            })}::jsonb,
            updated_at = now()
        where id = ${intent.payment_id}::uuid and provider = 'evotor' and status = 'pending'
      `;
      await sql`
        update public.fiscal_receipts
        set status = 'issued', provider_receipt_id = ${receiptReference},
            provider_status = 'succeeded', receipt_registration = 'succeeded',
            fiscalized_at = coalesce(fiscalized_at, now()),
            payload = coalesce(payload, '{}'::jsonb) || ${sql.json(result)}::jsonb,
            updated_at = now()
        where payment_id = ${intent.payment_id}::uuid and provider = 'evotor'
      `;
      await sql`
        update public.orders
        set payment_status = 'paid', fiscal_status = 'issued', is_operational = true,
            operational_started_at = coalesce(operational_started_at, now()),
            source_metadata = coalesce(source_metadata, '{}'::jsonb)
              || jsonb_build_object(
                'payment_confirmed', true,
                'payment_provider', 'evotor',
                'terminal_receipt_reference', ${receiptReference}::text
              ),
            updated_at = now()
      where id = ${intent.order_id}::uuid and payment_status = 'pending'
      `;
      await sql`
        insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
        select order_row.id, 'order.payment_succeeded',
               jsonb_build_object(
                 'order_id', order_row.id,
                 'location_id', order_row.location_id,
                 'provider', 'evotor'
               ),
               'order:' || order_row.id::text || ':payment:succeeded'
        from public.orders order_row
        where order_row.id = ${intent.order_id}::uuid
          and order_row.payment_status = 'paid'
          and order_row.is_operational = true
        on conflict (idempotency_key) do nothing
      `;
    } else if (nextStatus === "failed" || nextStatus === "cancelled") {
      await sql`
        update public.payments
        set status = 'cancelled', provider_status = 'canceled', receipt_registration = 'canceled',
            cancelled_at = coalesce(cancelled_at, now()),
            metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({ terminalFailure: details || nextStatus })}::jsonb,
            updated_at = now()
        where id = ${intent.payment_id}::uuid and provider = 'evotor' and status = 'pending'
      `;
      await sql`
        update public.fiscal_receipts
        set status = 'failed', provider_status = 'canceled', receipt_registration = 'canceled',
            error_message = ${details || "Оплата на терминале не была запущена."},
            payload = coalesce(payload, '{}'::jsonb) || ${sql.json(result)}::jsonb,
            updated_at = now()
        where payment_id = ${intent.payment_id}::uuid and provider = 'evotor'
      `;
      await sql`
        update public.orders
        set payment_status = 'cancelled', fiscal_status = 'failed', status = 'cancelled',
            kitchen_status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
            source_metadata = coalesce(source_metadata, '{}'::jsonb)
              || jsonb_build_object('payment_confirmed', false, 'payment_provider', 'evotor'),
            updated_at = now()
        where id = ${intent.order_id}::uuid and payment_status = 'pending'
      `;
      await sql`
        insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
        select order_row.id, 'order.payment_cancelled',
               jsonb_build_object('order_id', order_row.id, 'location_id', order_row.location_id,
                 'provider', 'evotor'),
               'order:' || order_row.id::text || ':payment:cancelled'
        from public.orders order_row
        where order_row.id = ${intent.order_id}::uuid and order_row.payment_status = 'cancelled'
        on conflict (idempotency_key) do nothing
      `;
    }

    await sql`
      insert into public.payment_events (
        payment_id, provider, provider_event_id, event_type, signature_verified, payload, processed_at
      ) values (
        ${intent.payment_id}::uuid,
        'evotor',
        ${`terminal:${intent.id}:${nextStatus}`},
        ${`terminal_payment_${nextStatus}`},
        false,
        ${sql.json(result)}::jsonb,
        now()
      )
      on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
    `;

    return { accepted: true, status: asStatus(nextStatus), orderId: intent.order_id };
  });
}

export async function getEvotorPosPaymentStatus(intentId: string): Promise<PosPaymentSummary | null> {
  return getPostgresSql().begin(async (sql) => {
    const [row] = await sql<{
      intent_id: string;
      order_id: string;
      display_number: string | null;
      status: string;
      amount: string | number;
      created_at: string;
      updated_at: string;
      result: Record<string, unknown>;
      location_id: string;
      created_by_staff_id: string | null;
    }[]>`
      select intent.id as intent_id, intent.order_id, order_row.display_number,
             intent.status, intent.amount, intent.created_at, intent.updated_at,
             intent.result, order_row.location_id, intent.created_by_staff_id
      from public.evotor_terminal_payment_intents intent
      join public.orders order_row on order_row.id = intent.order_id
      where intent.id = ${intentId}::uuid
      for update of intent
    `;
    if (!row) return null;
    let status = asStatus(row.status);
    if (["queued", "processing"].includes(status)
      && Date.now() - new Date(row.updated_at).getTime() > 5 * 60 * 1000) {
      status = "unknown";
      const details = row.status === "queued"
        ? "Терминал не получил заказ за 5 минут. Проверьте кассу перед отменой или повтором."
        : "Терминал не прислал результат за 5 минут. Проверьте оплату и чек на кассе.";
      const result = { ...row.result, details };
      await sql`
        update public.evotor_terminal_payment_intents
        set status = 'unknown', result = ${sql.json(result)}::jsonb, updated_at = now()
        where id = ${row.intent_id}::uuid and status = 'processing'
      `;
      row.result = result;
    }
    return {
      intentId: row.intent_id,
      orderId: row.order_id,
      displayNumber: row.display_number,
      status,
      amount: Number(row.amount),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: row.result,
      locationId: row.location_id,
      createdByStaffId: row.created_by_staff_id
    };
  });
}

export async function getActiveEvotorPosPayment(locationIds: string[]) {
  if (!locationIds.length) return null;
  const [intent] = await getPostgresSql()<{ id: string }[]>`
    select payment_intent.id
    from public.evotor_terminal_payment_intents payment_intent
    join public.evotor_terminal_devices device on device.id = payment_intent.device_id
    where device.location_id = any(${locationIds}::uuid[])
      and payment_intent.status in ('queued', 'processing', 'unknown')
    order by payment_intent.updated_at desc
    limit 1
  `;
  return intent ? getEvotorPosPaymentStatus(intent.id) : null;
}

export async function resolveUnknownEvotorPosPayment(params: {
  intentId: string;
  staffId: string | null;
  resolution: "paid" | "cancelled";
  receiptReference?: string;
}) {
  const result = await getPostgresSql().begin(async (sql) => {
    const [intent] = await sql<{ id: string; order_id: string; payment_id: string; status: string }[]>`
      select id, order_id, payment_id, status
      from public.evotor_terminal_payment_intents
      where id = ${params.intentId}::uuid
      for update
    `;
    if (!intent || intent.status !== "unknown") return false;
    if (params.resolution === "paid" && !params.receiptReference?.trim()) return false;
    const receiptReference = params.receiptReference?.trim() || "";
    const details = {
      manualResolution: params.resolution,
      resolvedByStaffId: params.staffId,
      resolvedAt: new Date().toISOString(),
      receiptReference: receiptReference.slice(0, 128) || null
    };
    const nextStatus = params.resolution;
    await sql`
      update public.evotor_terminal_payment_intents
      set status = ${nextStatus}, result = result || ${sql.json(details)}::jsonb,
          completed_at = now(), updated_at = now()
      where id = ${intent.id}::uuid
    `;
    if (nextStatus === "paid") {
      await sql`
        update public.payments
        set status = 'paid', provider_status = 'succeeded', payment_method = 'card',
            receipt_registration = 'succeeded', paid_at = coalesce(paid_at, now()),
            captured_at = coalesce(captured_at, now()), refundable_amount = 0,
            metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json(details)}::jsonb,
            updated_at = now()
        where id = ${intent.payment_id}::uuid and status = 'pending'
      `;
      await sql`
        update public.fiscal_receipts
        set status = 'issued', provider_receipt_id = ${receiptReference},
            provider_status = 'succeeded', receipt_registration = 'succeeded',
            fiscalized_at = coalesce(fiscalized_at, now()),
            payload = coalesce(payload, '{}'::jsonb) || ${sql.json(details)}::jsonb,
            updated_at = now()
        where payment_id = ${intent.payment_id}::uuid and provider = 'evotor'
      `;
      await sql`
        update public.orders
        set payment_status = 'paid', fiscal_status = 'issued', is_operational = true,
            operational_started_at = coalesce(operational_started_at, now()),
            source_metadata = coalesce(source_metadata, '{}'::jsonb)
              || jsonb_build_object('payment_confirmed', true, 'payment_provider', 'evotor',
                'terminal_receipt_reference', ${receiptReference}::text,
                'manual_payment_resolution', true),
            updated_at = now()
        where id = ${intent.order_id}::uuid and payment_status = 'pending'
      `;
      await sql`
        insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
        select order_row.id, 'order.payment_succeeded',
               jsonb_build_object(
                 'order_id', order_row.id,
                 'location_id', order_row.location_id,
                 'provider', 'evotor',
                 'manual_resolution', true
               ),
               'order:' || order_row.id::text || ':payment:succeeded'
        from public.orders order_row
        where order_row.id = ${intent.order_id}::uuid
          and order_row.payment_status = 'paid'
          and order_row.is_operational = true
        on conflict (idempotency_key) do nothing
      `;
    } else {
      await sql`
        update public.payments
        set status = 'cancelled', provider_status = 'canceled', receipt_registration = 'canceled',
            cancelled_at = coalesce(cancelled_at, now()),
            metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json(details)}::jsonb,
            updated_at = now()
        where id = ${intent.payment_id}::uuid and status = 'pending'
      `;
      await sql`
        update public.fiscal_receipts
        set status = 'failed', provider_status = 'canceled', receipt_registration = 'canceled',
            error_message = 'Сотрудник подтвердил, что оплата на терминале не прошла.',
            payload = coalesce(payload, '{}'::jsonb) || ${sql.json(details)}::jsonb,
            updated_at = now()
        where payment_id = ${intent.payment_id}::uuid and provider = 'evotor'
      `;
      await sql`
        update public.orders
        set payment_status = 'cancelled', fiscal_status = 'failed', status = 'cancelled',
            kitchen_status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
            source_metadata = coalesce(source_metadata, '{}'::jsonb)
              || jsonb_build_object('payment_confirmed', false, 'payment_provider', 'evotor'),
            updated_at = now()
        where id = ${intent.order_id}::uuid and payment_status = 'pending'
      `;
      await sql`
        insert into public.order_outbox (aggregate_id, event_type, payload, idempotency_key)
        select order_row.id, 'order.payment_cancelled',
               jsonb_build_object('order_id', order_row.id, 'location_id', order_row.location_id,
                 'provider', 'evotor', 'manual_resolution', true),
               'order:' || order_row.id::text || ':payment:cancelled'
        from public.orders order_row
        where order_row.id = ${intent.order_id}::uuid and order_row.payment_status = 'cancelled'
        on conflict (idempotency_key) do nothing
      `;
    }
    await sql`
      insert into public.payment_events (
        payment_id, provider, provider_event_id, event_type, signature_verified, payload, processed_at
      ) values (
        ${intent.payment_id}::uuid,
        'evotor',
        ${`terminal:${intent.id}:manual:${nextStatus}`},
        ${`terminal_payment_manually_resolved_${nextStatus}`},
        false,
        ${sql.json(details)}::jsonb,
        now()
      )
      on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
    `;
    await sql`
      insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, source_path)
      values ('staff', ${params.staffId}::uuid, 'payment.evotor_manual_resolution', 'payment',
        ${intent.payment_id}::text, ${sql.json(details)}::jsonb, '/pos')
    `;
    return true;
  });
  return result;
}
