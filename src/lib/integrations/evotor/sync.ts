import "server-only";

import { writeAuditLog } from "@/lib/audit";
import { getPostgresSql } from "@/lib/postgres/server";
import { EvotorApiError, EvotorClient } from "./client";
import { decryptEvotorToken } from "./crypto";
import { fetchEvotorDevices } from "./devices";
import { fetchEvotorDocuments } from "./documents";
import { fetchEvotorEmployees } from "./employees";
import { fetchEvotorProducts } from "./products";
import { parseEvotorReceipt, sanitizeEvotorPayload } from "./receipts";
import { fetchEvotorStores } from "./stores";
import type {
  EvotorDevice,
  EvotorDocument,
  EvotorEmployee,
  EvotorProduct,
  EvotorStore,
  EvotorSyncCounts
} from "./types";

type JsonValue = null | string | number | boolean | readonly JsonValue[] | {
  readonly [key: string]: JsonValue | undefined;
};

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function safeMessage(error: unknown) {
  if (error instanceof EvotorApiError) return error.message.slice(0, 500);
  return "Evotor synchronization failed.";
}

function displayName(employee: EvotorEmployee) {
  return [employee.last_name, employee.name, employee.patronymic_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "Сотрудник";
}

async function persistSnapshot(params: {
  connectionId: string;
  eventId: string;
  stores: EvotorStore[];
  devices: EvotorDevice[];
  employees: EvotorEmployee[];
  productsByStore: Map<string, EvotorProduct[]>;
  documentsByStore: Map<string, EvotorDocument[]>;
}) {
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const storeIds = new Map<string, string>();
    for (const store of params.stores) {
      const rows = await transaction<{ id: string }[]>`
        insert into public.evotor_stores (
          connection_id, evotor_store_id, name, address, raw_metadata, synchronized_at
        ) values (
          ${params.connectionId}::uuid, ${store.id}, ${store.name ?? "Магазин Эвотор"},
          ${store.address ?? null}, ${transaction.json(jsonValue(sanitizeEvotorPayload(store)))}, now()
        )
        on conflict (connection_id, evotor_store_id) do update
        set name = excluded.name, address = excluded.address,
            raw_metadata = excluded.raw_metadata, synchronized_at = now()
        returning id
      `;
      storeIds.set(store.id, rows[0].id);
    }

    const deviceIds = new Map<string, string>();
    for (const device of params.devices) {
      const internalStoreId = device.store_id ? storeIds.get(device.store_id) ?? null : null;
      const rows = await transaction<{ id: string }[]>`
        insert into public.evotor_devices (
          connection_id, store_id, evotor_device_id, name, status,
          timezone_offset, firmware_version, device_model, raw_metadata, synchronized_at
        ) values (
          ${params.connectionId}::uuid, ${internalStoreId}::uuid, ${device.id},
          ${device.name ?? null}, ${device.status ?? null}, ${device.timezone_offset ?? null},
          ${device.firmware_version ?? null}, ${device.device_model ?? null},
          ${transaction.json(jsonValue(sanitizeEvotorPayload({
            id: device.id,
            name: device.name,
            store_id: device.store_id,
            status: device.status,
            timezone_offset: device.timezone_offset,
            firmware_version: device.firmware_version,
            device_model: device.device_model
          })))}, now()
        )
        on conflict (connection_id, evotor_device_id) do update
        set store_id = excluded.store_id, name = excluded.name, status = excluded.status,
            timezone_offset = excluded.timezone_offset, firmware_version = excluded.firmware_version,
            device_model = excluded.device_model, raw_metadata = excluded.raw_metadata,
            synchronized_at = now()
        returning id
      `;
      deviceIds.set(device.id, rows[0].id);
    }

    for (const employee of params.employees) {
      await transaction`
        insert into public.evotor_employees (
          connection_id, evotor_employee_id, display_name, role_name,
          evotor_store_ids, raw_metadata, synchronized_at
        ) values (
          ${params.connectionId}::uuid, ${employee.id}, ${displayName(employee)},
          ${employee.role ?? employee.role_id ?? null}, ${transaction.json(employee.stores ?? [])},
          ${transaction.json(jsonValue(sanitizeEvotorPayload({
            id: employee.id,
            name: employee.name,
            last_name: employee.last_name,
            patronymic_name: employee.patronymic_name,
            stores: employee.stores,
            role: employee.role,
            role_id: employee.role_id
          })))}, now()
        )
        on conflict (connection_id, evotor_employee_id) do update
        set display_name = excluded.display_name, role_name = excluded.role_name,
            evotor_store_ids = excluded.evotor_store_ids, raw_metadata = excluded.raw_metadata,
            synchronized_at = now()
      `;
    }

    for (const [externalStoreId, products] of params.productsByStore) {
      const storeId = storeIds.get(externalStoreId);
      if (!storeId) continue;
      for (const product of products) {
        await transaction`
          insert into public.evotor_products (
            connection_id, store_id, evotor_product_id, name, code, article_number,
            barcodes, price, cost_price, measure_name, tax, allow_to_sell,
            is_removed, raw_metadata, synchronized_at
          ) values (
            ${params.connectionId}::uuid, ${storeId}::uuid, ${product.id},
            ${product.name ?? "Позиция Эвотор"}, ${product.code ?? null},
            ${product.article_number ?? null},
            ${transaction.json(product.barcodes ?? product.bar_codes ?? [])},
            ${product.price ?? 0}, ${product.cost_price ?? null}, ${product.measure_name ?? null},
            ${product.tax === null || product.tax === undefined ? null : String(product.tax)},
            ${product.allow_to_sell ?? null}, ${product.is_removed ?? product.isRemoved ?? false},
            ${transaction.json(jsonValue(sanitizeEvotorPayload(product)))}, now()
          )
          on conflict (store_id, evotor_product_id) do update
          set name = excluded.name, code = excluded.code, article_number = excluded.article_number,
              barcodes = excluded.barcodes, price = excluded.price, cost_price = excluded.cost_price,
              measure_name = excluded.measure_name, tax = excluded.tax,
              allow_to_sell = excluded.allow_to_sell, is_removed = excluded.is_removed,
              raw_metadata = excluded.raw_metadata, synchronized_at = now()
        `;
      }
    }

    await transaction`
      insert into public.evotor_product_mappings (
        evotor_product_id, karimoff_product_id, status, match_method, confidence
      )
      select ep.id, p.id, 'suggested', 'exact_name', 0.7
      from public.evotor_products ep
      join public.products p on lower(trim(p.name)) = lower(trim(ep.name))
      where ep.connection_id = ${params.connectionId}::uuid
        and not exists (
          select 1 from public.evotor_product_mappings m where m.evotor_product_id = ep.id
        )
        and (
          select count(*) from public.products px where lower(trim(px.name)) = lower(trim(ep.name))
        ) = 1
      on conflict (evotor_product_id) do nothing
    `;

    let receiptCount = 0;
    for (const [externalStoreId, documents] of params.documentsByStore) {
      const storeId = storeIds.get(externalStoreId);
      if (!storeId) continue;
      for (const document of documents) {
        const deviceId = document.device_id ? deviceIds.get(document.device_id) ?? null : null;
        const documentRows = await transaction<{ id: string }[]>`
          insert into public.evotor_documents (
            connection_id, store_id, device_id, evotor_document_id, document_type,
            document_number, close_date, evotor_employee_id, raw_metadata, synchronized_at
          ) values (
            ${params.connectionId}::uuid, ${storeId}::uuid, ${deviceId}::uuid,
            ${document.id}, ${document.type},
            ${document.number === null || document.number === undefined ? null : String(document.number)},
            ${document.close_date ?? null}, ${document.employee_id ?? document.close_user_id ?? null},
            ${transaction.json(jsonValue(sanitizeEvotorPayload(document)))}, now()
          )
          on conflict (connection_id, evotor_document_id) do update
          set store_id = excluded.store_id, device_id = excluded.device_id,
              document_type = excluded.document_type, document_number = excluded.document_number,
              close_date = excluded.close_date, evotor_employee_id = excluded.evotor_employee_id,
              raw_metadata = excluded.raw_metadata, synchronized_at = now()
          returning id
        `;
        const receipt = parseEvotorReceipt(document);
        if (!receipt) continue;
        receiptCount += 1;
        const receiptRows = await transaction<{ id: string }[]>`
          insert into public.evotor_receipts (
            connection_id, document_id, store_id, device_id, external_receipt_id,
            receipt_type, receipt_number, evotor_employee_id, closed_at, subtotal,
            discount, total, payment_types, fiscal_document_number,
            fiscal_drive_number, fiscal_sign, raw_metadata, synchronized_at
          ) values (
            ${params.connectionId}::uuid, ${documentRows[0].id}::uuid, ${storeId}::uuid,
            ${deviceId}::uuid, ${receipt.externalId}, ${receipt.type}, ${receipt.number},
            ${receipt.employeeId}, ${receipt.closedAt}, ${receipt.subtotal}, ${receipt.discount},
            ${receipt.total}, ${transaction.json(receipt.payments)}, ${receipt.fiscalDocumentNumber},
            ${receipt.fiscalDriveNumber}, ${receipt.fiscalSign}, ${transaction.json(jsonValue(receipt.raw))}, now()
          )
          on conflict (connection_id, external_receipt_id) do update
          set document_id = excluded.document_id, store_id = excluded.store_id,
              device_id = excluded.device_id, receipt_type = excluded.receipt_type,
              receipt_number = excluded.receipt_number, evotor_employee_id = excluded.evotor_employee_id,
              closed_at = excluded.closed_at, subtotal = excluded.subtotal,
              discount = excluded.discount, total = excluded.total,
              payment_types = excluded.payment_types,
              fiscal_document_number = excluded.fiscal_document_number,
              fiscal_drive_number = excluded.fiscal_drive_number, fiscal_sign = excluded.fiscal_sign,
              raw_metadata = excluded.raw_metadata, synchronized_at = now()
          returning id
        `;
        for (const item of receipt.items) {
          await transaction`
            insert into public.evotor_receipt_items (
              receipt_id, source_key, evotor_product_id, name, quantity,
              unit_price, discount, line_total, tax, raw_metadata
            ) values (
              ${receiptRows[0].id}::uuid, ${item.sourceKey}, ${item.productId}, ${item.name},
              ${item.quantity}, ${item.unitPrice}, ${item.discount}, ${item.lineTotal},
              ${item.tax}, ${transaction.json(jsonValue(item.raw))}
            )
            on conflict (receipt_id, source_key) do update
            set evotor_product_id = excluded.evotor_product_id, name = excluded.name,
                quantity = excluded.quantity, unit_price = excluded.unit_price,
                discount = excluded.discount, line_total = excluded.line_total,
                tax = excluded.tax, raw_metadata = excluded.raw_metadata
          `;
        }
      }
    }

    return receiptCount;
  });
}

export async function processEvotorSyncEvent(eventId: string) {
  const sql = getPostgresSql();
  const claimed = await sql<{
    id: string;
    connection_id: string;
    sync_type: string;
    period_from: string | null;
    period_to: string | null;
    encrypted_token: string;
  }[]>`
    update public.evotor_sync_events e
    set status = 'running', started_at = now()
    from public.evotor_connections c
    where e.id = ${eventId}::uuid
      and e.connection_id = c.id
      and e.status = 'pending'
    returning e.id, e.connection_id, e.sync_type, e.period_from, e.period_to, c.encrypted_token
  `;
  if (!claimed[0]) return { skipped: true } as const;

  const event = claimed[0];
  try {
    const client = new EvotorClient(decryptEvotorToken(event.encrypted_token));
    const stores = await fetchEvotorStores(client);
    const isConnectionCheck = event.sync_type === "check";
    const devices = await fetchEvotorDevices(client);
    const employees = isConnectionCheck ? [] : await fetchEvotorEmployees(client);
    const productsByStore = new Map<string, EvotorProduct[]>();
    const documentsByStore = new Map<string, EvotorDocument[]>();
    const since = event.period_from ? new Date(event.period_from) : new Date(Date.now() - 7 * 86_400_000);
    const until = event.period_to ? new Date(event.period_to) : new Date();

    if (!isConnectionCheck) {
      for (const store of stores) {
        productsByStore.set(store.id, await fetchEvotorProducts(client, store.id));
        documentsByStore.set(store.id, await fetchEvotorDocuments(client, { storeId: store.id, since, until }));
      }
    }

    const receipts = await persistSnapshot({
      connectionId: event.connection_id,
      eventId: event.id,
      stores,
      devices,
      employees,
      productsByStore,
      documentsByStore
    });
    const counts: EvotorSyncCounts = {
      stores: stores.length,
      devices: devices.length,
      employees: employees.length,
      products: Array.from(productsByStore.values()).reduce((sum, items) => sum + items.length, 0),
      documents: Array.from(documentsByStore.values()).reduce((sum, items) => sum + items.length, 0),
      receipts
    };
    await sql.begin(async (transaction) => {
      await transaction`
        update public.evotor_sync_events
        set status = 'success', finished_at = now(), result_counts = ${transaction.json(counts)}
        where id = ${event.id}::uuid
      `;
      await transaction`
        update public.evotor_connections
        set status = 'connected', last_sync_at = now(), last_success_at = now(),
            last_error_at = null, last_error_message = null
        where id = ${event.connection_id}::uuid
      `;
    });
    await writeAuditLog({
      action: "evotor.sync.success",
      actorType: "system",
      entityType: "evotor_connection",
      entityId: event.connection_id,
      metadata: { event_id: event.id, sync_type: event.sync_type, counts },
      sourcePath: "/api/integrations/evotor"
    });
    return { skipped: false, counts } as const;
  } catch (error) {
    const message = safeMessage(error);
    const status = error instanceof EvotorApiError ? error.status : null;
    const retryable = error instanceof EvotorApiError ? error.retryable : false;
    await sql.begin(async (transaction) => {
      await transaction`
        update public.evotor_sync_events
        set status = 'failed', finished_at = now()
        where id = ${event.id}::uuid
      `;
      await transaction`
        update public.evotor_connections
        set status = ${status === 401 ? "revoked" : "error"},
            last_sync_at = now(), last_error_at = now(), last_error_message = ${message}
        where id = ${event.connection_id}::uuid
      `;
      await transaction`
        insert into public.evotor_sync_errors (
          connection_id, sync_event_id, scope, error_code, http_status, message, retryable
        ) values (
          ${event.connection_id}::uuid, ${event.id}::uuid,
          ${error instanceof EvotorApiError ? error.endpoint : "sync"},
          ${error instanceof EvotorApiError ? error.providerCode ?? error.name : "SYNC_ERROR"},
          ${status}, ${message}, ${retryable}
        )
      `;
    });
    await writeAuditLog({
      action: "evotor.sync.failed",
      actorType: "system",
      entityType: "evotor_connection",
      entityId: event.connection_id,
      metadata: { event_id: event.id, sync_type: event.sync_type, http_status: status, retryable },
      sourcePath: "/api/integrations/evotor"
    });
    return { skipped: false, error: message } as const;
  }
}
