import "server-only";

import { createHash } from "node:crypto";
import { writeAuditLog } from "@/lib/audit";
import { getPostgresSql } from "@/lib/postgres/server";
import { EvotorApiError, EvotorClient } from "./client";
import { decryptEvotorToken } from "./crypto";
import { fetchEvotorDevices } from "./devices";
import { fetchEvotorDocuments } from "./documents";
import { fetchEvotorEmployees } from "./employees";
import { EvotorConfigurationError } from "./errors";
import { fetchEvotorProducts } from "./products";
import { parseEvotorReceipt, sanitizeEvotorPayload } from "./receipts";
import { classifyEvotorFailure, evotorRetryDelaySeconds } from "./recovery";
import { fetchEvotorStores } from "./stores";
import type {
  EvotorDevice,
  EvotorDocument,
  EvotorEmployee,
  EvotorProduct,
  EvotorReceipt,
  EvotorStore,
  EvotorSyncCounts
} from "./types";

type JsonValue = null | string | number | boolean | readonly JsonValue[] | {
  readonly [key: string]: JsonValue | undefined;
};

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function receiptSourceHash(receipt: EvotorReceipt) {
  const items = receipt.items
    .map((item) => ({
      sourceKey: item.sourceKey,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      lineTotal: item.lineTotal,
      tax: item.tax
    }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  const payments = [...receipt.payments].sort((left, right) => (
    `${left.type}:${left.sum}`.localeCompare(`${right.type}:${right.sum}`)
  ));
  return createHash("sha256").update(JSON.stringify({
    externalId: receipt.externalId,
    type: receipt.type,
    number: receipt.number,
    employeeId: receipt.employeeId,
    closedAt: receipt.closedAt,
    subtotal: receipt.subtotal,
    discount: receipt.discount,
    total: receipt.total,
    payments,
    items
  })).digest("hex");
}

function safeMessage(error: unknown) {
  if (error instanceof EvotorApiError) return error.message.slice(0, 500);
  if (error instanceof EvotorConfigurationError) return error.message.slice(0, 500);
  return "Evotor synchronization failed.";
}

function failureContext(error: unknown) {
  if (error instanceof EvotorConfigurationError) {
    return { source: "configuration" as const };
  }
  if (error instanceof EvotorApiError) {
    return {
      source: "api" as const,
      status: error.status,
      retryable: error.retryable
    };
  }
  return { source: "unknown" as const };
}

function displayName(employee: EvotorEmployee) {
  return [employee.last_name, employee.name, employee.patronymic_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "Сотрудник";
}

type SyncWindow = { since: Date; until: Date };

type PersistResult = {
  receipts: number;
  imported: number;
  updated: number;
  cursorBefore: Date | null;
  cursorAfter: Date | null;
};

async function persistSnapshot(params: {
  connectionId: string;
  eventId: string;
  syncType: string;
  stores: EvotorStore[];
  devices: EvotorDevice[];
  employees: EvotorEmployee[];
  productsByStore: Map<string, EvotorProduct[]>;
  documentsByStore: Map<string, EvotorDocument[]>;
  windowsByStore: Map<string, SyncWindow>;
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
    let importedCount = 0;
    let updatedCount = 0;
    let cursorBefore: Date | null = null;
    let cursorAfter: Date | null = null;
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
        const sourceHash = receiptSourceHash(receipt);
        const previousReceipt = await transaction<{ id: string; source_hash: string | null }[]>`
          select id, source_hash
          from public.evotor_receipts
          where connection_id = ${params.connectionId}::uuid
            and external_receipt_id = ${receipt.externalId}
          for update
        `;
        const receiptRows = await transaction<{ id: string; inserted: boolean }[]>`
          insert into public.evotor_receipts (
            connection_id, document_id, store_id, device_id, external_receipt_id,
            receipt_type, receipt_number, evotor_employee_id, closed_at, subtotal,
            discount, total, payment_types, fiscal_document_number,
            fiscal_drive_number, fiscal_sign, source_hash, raw_metadata, synchronized_at
          ) values (
            ${params.connectionId}::uuid, ${documentRows[0].id}::uuid, ${storeId}::uuid,
            ${deviceId}::uuid, ${receipt.externalId}, ${receipt.type}, ${receipt.number},
            ${receipt.employeeId}, ${receipt.closedAt}, ${receipt.subtotal}, ${receipt.discount},
            ${receipt.total}, ${transaction.json(receipt.payments)}, ${receipt.fiscalDocumentNumber},
            ${receipt.fiscalDriveNumber}, ${receipt.fiscalSign}, ${sourceHash},
            ${transaction.json(jsonValue(receipt.raw))}, now()
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
              source_hash = excluded.source_hash,
              raw_metadata = excluded.raw_metadata, synchronized_at = now()
          returning id, (xmax = 0) as inserted
        `;
        if (!previousReceipt[0]) importedCount += 1;
        else if (previousReceipt[0].source_hash !== sourceHash) updatedCount += 1;
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
        const itemKeys = receipt.items.map((item) => item.sourceKey);
        if (itemKeys.length) {
          await transaction`
            delete from public.evotor_receipt_items
            where receipt_id = ${receiptRows[0].id}::uuid
              and not (source_key = any(${itemKeys}::text[]))
          `;
        } else {
          await transaction`
            delete from public.evotor_receipt_items
            where receipt_id = ${receiptRows[0].id}::uuid
          `;
        }
      }

      const window = params.windowsByStore.get(externalStoreId);
      if (window) {
        const previousRows = await transaction<{ cursor_time: string | null }[]>`
          select cursor_time
          from public.evotor_sync_cursors
          where connection_id = ${params.connectionId}::uuid
            and store_id = ${storeId}::uuid
          for update
        `;
        const previous = previousRows[0]?.cursor_time ? new Date(previousRows[0].cursor_time) : null;
        if (previous && (!cursorBefore || previous < cursorBefore)) cursorBefore = previous;
        const latestDocumentAt = documents.reduce<Date | null>((latest, document) => {
          const value = document.close_date ? new Date(document.close_date) : null;
          if (!value || Number.isNaN(value.getTime())) return latest;
          return !latest || value > latest ? value : latest;
        }, null);
        await transaction`
          insert into public.evotor_sync_cursors (
            connection_id, store_id, cursor_time, last_document_id,
            last_incremental_at, last_reconciled_at, last_seen_document_at, updated_at
          ) values (
            ${params.connectionId}::uuid, ${storeId}::uuid, ${window.until.toISOString()},
            ${documents.at(-1)?.id ?? null},
            ${params.syncType === "reconciliation" ? null : new Date().toISOString()}::timestamptz,
            ${params.syncType === "reconciliation" ? new Date().toISOString() : null}::timestamptz,
            ${latestDocumentAt?.toISOString() ?? null}, now()
          )
          on conflict (connection_id, store_id) do update
          set cursor_time = greatest(
                coalesce(public.evotor_sync_cursors.cursor_time, '-infinity'::timestamptz),
                excluded.cursor_time
              ),
              last_document_id = coalesce(excluded.last_document_id, public.evotor_sync_cursors.last_document_id),
              last_incremental_at = coalesce(
                excluded.last_incremental_at,
                public.evotor_sync_cursors.last_incremental_at
              ),
              last_reconciled_at = coalesce(
                excluded.last_reconciled_at,
                public.evotor_sync_cursors.last_reconciled_at
              ),
              last_seen_document_at = case
                when excluded.last_seen_document_at is null
                  then public.evotor_sync_cursors.last_seen_document_at
                when public.evotor_sync_cursors.last_seen_document_at is null
                  then excluded.last_seen_document_at
                else greatest(
                  public.evotor_sync_cursors.last_seen_document_at,
                  excluded.last_seen_document_at
                )
              end,
              updated_at = now()
        `;
        if (!cursorAfter || window.until > cursorAfter) cursorAfter = window.until;
      }
    }

    return {
      receipts: receiptCount,
      imported: importedCount,
      updated: updatedCount,
      cursorBefore,
      cursorAfter
    } satisfies PersistResult;
  });
}

async function resolveSyncWindow(params: {
  connectionId: string;
  externalStoreId: string;
  syncType: string;
  periodFrom: string | null;
  periodTo: string | null;
  now: Date;
}): Promise<SyncWindow> {
  const until = params.periodTo ? new Date(params.periodTo) : params.now;
  if (params.periodFrom) return { since: new Date(params.periodFrom), until };
  if (!["incremental", "webhook"].includes(params.syncType)) {
    return { since: new Date(until.getTime() - 7 * 86_400_000), until };
  }

  const sql = getPostgresSql();
  const rows = await sql<{ cursor_time: string | null; overlap_seconds: number | null }[]>`
    select cursor.cursor_time, cursor.overlap_seconds
    from public.evotor_stores store
    left join public.evotor_sync_cursors cursor
      on cursor.connection_id = store.connection_id
     and cursor.store_id = store.id
    where store.connection_id = ${params.connectionId}::uuid
      and store.evotor_store_id = ${params.externalStoreId}
    limit 1
  `;
  const cursor = rows[0]?.cursor_time ? new Date(rows[0].cursor_time) : null;
  const overlap = Math.max(60, Number(rows[0]?.overlap_seconds ?? 300));
  return {
    since: cursor
      ? new Date(cursor.getTime() - overlap * 1000)
      : new Date(until.getTime() - 24 * 60 * 60 * 1000),
    until
  };
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
    retry_count: number;
    connection_retry_count: number;
  }[]>`
    update public.evotor_sync_events e
    set status = 'running', started_at = now()
    from public.evotor_connections c
    where e.id = ${eventId}::uuid
      and e.connection_id = c.id
      and e.status = 'pending'
      and e.available_at <= now()
      and (
        c.status in ('connected', 'error')
        or e.requested_by not in ('scheduler', 'app-background-worker', 'timeweb-scheduler')
      )
    returning e.id, e.connection_id, e.sync_type, e.period_from, e.period_to,
      e.retry_count, c.encrypted_token, c.retry_count as connection_retry_count
  `;
  if (!claimed[0]) return { skipped: true } as const;

  const event = claimed[0];
  await sql`
    update public.evotor_connections
    set last_sync_started_at = now()
    where id = ${event.connection_id}::uuid
  `;
  try {
    const client = new EvotorClient(decryptEvotorToken(event.encrypted_token));
    const stores = await fetchEvotorStores(client);
    const isConnectionCheck = event.sync_type === "check";
    const isFullCatalogSync = ["initial", "installation", "manual"].includes(event.sync_type);
    const devices = await fetchEvotorDevices(client);
    const employees = isFullCatalogSync && !isConnectionCheck
      ? await fetchEvotorEmployees(client)
      : [];
    const productsByStore = new Map<string, EvotorProduct[]>();
    const documentsByStore = new Map<string, EvotorDocument[]>();
    const windowsByStore = new Map<string, SyncWindow>();
    const now = new Date();

    if (!isConnectionCheck) {
      for (const store of stores) {
        if (isFullCatalogSync) {
          productsByStore.set(store.id, await fetchEvotorProducts(client, store.id));
        }
        const window = await resolveSyncWindow({
          connectionId: event.connection_id,
          externalStoreId: store.id,
          syncType: event.sync_type,
          periodFrom: event.period_from,
          periodTo: event.period_to,
          now
        });
        windowsByStore.set(store.id, window);
        documentsByStore.set(store.id, await fetchEvotorDocuments(client, {
          storeId: store.id,
          since: window.since,
          until: window.until
        }));
      }
    }

    const persisted = await persistSnapshot({
      connectionId: event.connection_id,
      eventId: event.id,
      syncType: event.sync_type,
      stores,
      devices,
      employees,
      productsByStore,
      documentsByStore,
      windowsByStore
    });
    const counts: EvotorSyncCounts = {
      stores: stores.length,
      devices: devices.length,
      employees: employees.length,
      products: Array.from(productsByStore.values()).reduce((sum, items) => sum + items.length, 0),
      documents: Array.from(documentsByStore.values()).reduce((sum, items) => sum + items.length, 0),
      receipts: persisted.receipts
    };
    await sql.begin(async (transaction) => {
      await transaction`
        update public.evotor_sync_events
        set status = 'success', finished_at = now(), result_counts = ${transaction.json(counts)},
            imported_count = ${persisted.imported}, updated_count = ${persisted.updated},
            failed_count = 0, cursor_before = ${persisted.cursorBefore?.toISOString() ?? null},
            cursor_after = ${persisted.cursorAfter?.toISOString() ?? null}
        where id = ${event.id}::uuid
      `;
      await transaction`
        update public.evotor_connections
        set status = 'connected', last_sync_at = now(), last_success_at = now(),
            last_cursor_at = coalesce(
              ${persisted.cursorAfter?.toISOString() ?? null}::timestamptz,
              last_cursor_at
            ),
            last_imported_receipts = ${persisted.imported},
            last_updated_receipts = ${persisted.updated},
            failed_items = 0, retry_count = 0,
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
    return {
      skipped: false,
      counts,
      imported: persisted.imported,
      updated: persisted.updated
    } as const;
  } catch (error) {
    const message = safeMessage(error);
    const status = error instanceof EvotorApiError ? error.status : null;
    const classification = classifyEvotorFailure(failureContext(error));
    const retryable = classification.kind === "transient";
    const nextFailureCount = event.connection_retry_count + 1;
    const retryDelaySeconds = evotorRetryDelaySeconds(nextFailureCount);
    const nextRetryAt = retryable
      ? new Date(Date.now() + retryDelaySeconds * 1000)
      : null;
    await sql.begin(async (transaction) => {
      await transaction`
        update public.evotor_sync_events
        set status = ${retryable ? "pending" : "failed"},
            started_at = case when ${retryable} then null else started_at end,
            finished_at = ${retryable ? null : new Date().toISOString()},
            retry_count = retry_count + 1,
            failed_count = failed_count + 1,
            available_at = case
              when ${retryable} then ${nextRetryAt?.toISOString() ?? null}::timestamptz
              else available_at
            end
        where id = ${event.id}::uuid
      `;
      await transaction`
        update public.evotor_connections
        set status = ${classification.connectionStatus},
            last_sync_at = now(), last_error_at = now(), last_error_message = ${message},
            failed_items = failed_items + 1,
            retry_count = retry_count + 1
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
      metadata: {
        event_id: event.id,
        sync_type: event.sync_type,
        http_status: status,
        retryable,
        failure_kind: classification.kind,
        next_retry_at: nextRetryAt?.toISOString() ?? null
      },
      sourcePath: "/api/integrations/evotor"
    });
    return {
      skipped: false,
      error: message,
      retryScheduled: retryable,
      nextRetryAt: nextRetryAt?.toISOString() ?? null
    } as const;
  }
}

export async function processPendingEvotorSyncEvents(limit = 5) {
  const sql = getPostgresSql();
  const events = await sql<{ id: string }[]>`
    select id
    from public.evotor_sync_events
    where status = 'pending' and available_at <= now()
    order by created_at
    limit ${Math.min(20, Math.max(1, limit))}
  `;
  const results = [];
  for (const event of events) {
    results.push(await processEvotorSyncEvent(event.id));
  }
  return results;
}
