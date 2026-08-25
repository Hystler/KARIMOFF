import "server-only";

import { createHash } from "node:crypto";
import { logOperationalEvent } from "@/lib/observability";
import { getPostgresSql } from "@/lib/postgres/server";
import { encryptEvotorToken, fingerprintEvotorToken, tryDecryptEvotorToken } from "./crypto";

const TOKEN_DECRYPTION_ERROR_PREFIX = "Evotor token could not be decrypted";

export type EvotorSyncType =
  | "initial"
  | "manual"
  | "check"
  | "installation"
  | "uninstallation"
  | "incremental"
  | "reconciliation"
  | "webhook";

export async function registerEvotorConnection(userId: string, token: string) {
  const sql = getPostgresSql();
  const fingerprint = fingerprintEvotorToken(token);
  const encryptedToken = encryptEvotorToken(token);

  return sql.begin(async (transaction) => {
    const existingRows = await transaction<{
      id: string;
      evotor_user_id: string;
      token_fingerprint: string;
    }[]>`
      select id, evotor_user_id, token_fingerprint
      from public.evotor_connections
      where evotor_user_id = ${userId} or token_fingerprint = ${fingerprint}
      for update
    `;
    const existingByUser = existingRows.find((row) => row.evotor_user_id === userId);
    const existingByFingerprint = existingRows.find((row) => row.token_fingerprint === fingerprint);
    if (existingByFingerprint && existingByFingerprint.evotor_user_id !== userId) {
      throw new Error("Evotor token ownership conflict.");
    }
    if (existingByUser && existingByFingerprint && existingByUser.id !== existingByFingerprint.id) {
      throw new Error("Evotor connection conflict.");
    }
    const existing = existingByUser ?? existingByFingerprint;

    let connectionId: string;
    let tokenChanged = false;
    if (existing) {
      connectionId = existing.id;
      tokenChanged = existing.token_fingerprint !== fingerprint;
      await transaction`
        update public.evotor_connections
        set evotor_user_id = ${userId},
            encrypted_token = ${encryptedToken},
            token_fingerprint = ${fingerprint},
            status = 'connected',
            installed_at = coalesce(installed_at, now()),
            failed_items = 0,
            retry_count = 0,
            last_error_at = null,
            last_error_message = null
        where id = ${connectionId}::uuid
      `;
    } else {
      const created = await transaction<{ id: string }[]>`
        insert into public.evotor_connections (
          evotor_user_id, encrypted_token, token_fingerprint, status, installed_at
        ) values (
          ${userId}, ${encryptedToken}, ${fingerprint}, 'connected', now()
        )
        returning id
      `;
      connectionId = created[0].id;
      tokenChanged = true;
    }

    const idempotencyKey = createHash("sha256")
      .update(`token:${userId}:${fingerprint}`)
      .digest("hex");
    const event = await transaction<{ id: string }[]>`
      insert into public.evotor_sync_events (
        connection_id, sync_type, status, idempotency_key, requested_by,
        period_from, period_to
      ) values (
        ${connectionId}::uuid, 'initial', 'pending', ${idempotencyKey}, 'evotor',
        now() - interval '7 days', now()
      )
      on conflict (idempotency_key) do update
      set connection_id = excluded.connection_id,
          status = case
            when evotor_sync_events.status = 'failed' then 'pending'
            else evotor_sync_events.status
          end,
          started_at = case when evotor_sync_events.status = 'failed' then null else evotor_sync_events.started_at end,
          finished_at = case when evotor_sync_events.status = 'failed' then null else evotor_sync_events.finished_at end
      returning id
    `;

    return { connectionId, eventId: event[0].id, tokenChanged };
  });
}

export async function createEvotorSyncEvent(params: {
  connectionId: string;
  syncType: Exclude<EvotorSyncType, "initial">;
  requestedBy: string;
  idempotencyKey?: string;
  periodFrom?: Date | null;
  periodTo?: Date | null;
}) {
  const sql = getPostgresSql();
  const idempotencyKey = params.idempotencyKey ?? createHash("sha256")
    .update(`${params.syncType}:${params.connectionId}:${Date.now()}:${Math.random()}`)
    .digest("hex");
  const rows = await sql<{ id: string }[]>`
    insert into public.evotor_sync_events (
      connection_id, sync_type, status, idempotency_key, requested_by,
      period_from, period_to
    ) values (
      ${params.connectionId}::uuid, ${params.syncType}, 'pending', ${idempotencyKey},
      ${params.requestedBy},
      ${params.periodFrom?.toISOString() ?? null}::timestamptz,
      ${params.periodTo?.toISOString() ?? null}::timestamptz
    )
    on conflict (idempotency_key) do update
    set connection_id = excluded.connection_id,
        status = case
          when evotor_sync_events.status = 'failed' then 'pending'
          else evotor_sync_events.status
        end,
        started_at = case when evotor_sync_events.status = 'failed' then null else evotor_sync_events.started_at end,
        finished_at = case when evotor_sync_events.status = 'failed' then null else evotor_sync_events.finished_at end
    returning id
  `;
  return rows[0].id;
}

export async function queueDueEvotorSyncs(params: {
  syncType: "incremental" | "reconciliation";
  requestedBy?: string;
  now?: Date;
}) {
  const sql = getPostgresSql();
  const now = params.now ?? new Date();
  await recoverStaleEvotorSyncEvents(now);
  const recoveredConnections = await recoverEvotorCryptoBlockedConnections();
  const bucketMs = params.syncType === "incremental" ? 60_000 : 3_600_000;
  const bucket = Math.floor(now.getTime() / bucketMs);
  const connections = await sql<{ id: string; encrypted_token: string }[]>`
    select id, encrypted_token
    from public.evotor_connections connection
    where connection.status in ('connected', 'error')
      and (
        connection.status = 'connected'
        or connection.last_error_at is null
        or connection.last_error_at + make_interval(
          secs => least(
            900,
            (30 * power(2, least(greatest(connection.retry_count - 1, 0), 5)))::integer
          )
        ) <= ${now.toISOString()}::timestamptz
      )
      and not exists (
        select 1
        from public.evotor_sync_events event
        where event.connection_id = connection.id
          and event.status in ('pending', 'running')
          and event.sync_type in ('initial', 'manual', 'incremental', 'reconciliation', 'webhook')
      )
    order by connection.last_success_at nulls first, connection.created_at
  `;
  const eventIds: string[] = [];
  let incompatibleConnections = 0;
  for (const connection of connections) {
    if (!tryDecryptEvotorToken(connection.encrypted_token).ok) {
      incompatibleConnections += 1;
      continue;
    }
    const eventId = await createEvotorSyncEvent({
      connectionId: connection.id,
      syncType: params.syncType,
      requestedBy: params.requestedBy ?? "scheduler",
      idempotencyKey: createHash("sha256")
        .update(`${params.syncType}:${connection.id}:${bucket}`)
        .digest("hex"),
      periodFrom: params.syncType === "reconciliation"
        ? new Date(now.getTime() - 72 * 60 * 60 * 1000)
        : null,
      periodTo: now
    });
    eventIds.push(eventId);
  }
  if (incompatibleConnections || recoveredConnections.length) {
    logOperationalEvent("evotor.crypto_compatibility", {
      skipped_connections: incompatibleConnections,
      recovered_connections: recoveredConnections.length
    });
  }
  return eventIds;
}

export async function recoverEvotorCryptoBlockedConnections() {
  const sql = getPostgresSql();
  const blocked = await sql<{ id: string; encrypted_token: string }[]>`
    select id, encrypted_token
    from public.evotor_connections
    where status = 'uninstalled'
      and last_error_message like ${`${TOKEN_DECRYPTION_ERROR_PREFIX}%`}
  `;
  const recovered: string[] = [];
  let incompatibleConnections = 0;
  const incompatibleErrorCodes = new Set<string>();
  for (const connection of blocked) {
    const cryptoCheck = tryDecryptEvotorToken(connection.encrypted_token);
    if (!cryptoCheck.ok) {
      incompatibleConnections += 1;
      incompatibleErrorCodes.add(cryptoCheck.errorCode);
      continue;
    }
    const rows = await sql<{ id: string }[]>`
      update public.evotor_connections
      set status = 'error',
          failed_items = 0,
          retry_count = 0,
          last_error_at = null,
          last_error_message = null
      where id = ${connection.id}::uuid
        and encrypted_token = ${connection.encrypted_token}
        and status = 'uninstalled'
        and last_error_message like ${`${TOKEN_DECRYPTION_ERROR_PREFIX}%`}
      returning id
    `;
    if (rows[0]) recovered.push(rows[0].id);
  }
  if (incompatibleConnections) {
    logOperationalEvent("evotor.crypto_worker_skipped", {
      skipped_connections: incompatibleConnections,
      error_codes: Array.from(incompatibleErrorCodes).sort().join(",")
    });
  }
  return recovered;
}

export async function recoverStaleEvotorSyncEvents(now = new Date()) {
  const sql = getPostgresSql();
  return sql<{ id: string }[]>`
    with recovered as (
      update public.evotor_sync_events
      set status = 'pending',
          started_at = null,
          finished_at = null,
          retry_count = retry_count + 1,
          failed_count = failed_count + 1,
          available_at = ${new Date(now.getTime() + 30_000).toISOString()}::timestamptz
      where status = 'running'
        and started_at < ${new Date(now.getTime() - 15 * 60_000).toISOString()}::timestamptz
        and exists (
          select 1
          from public.evotor_connections connection
          where connection.id = evotor_sync_events.connection_id
            and connection.status in ('connected', 'error')
        )
      returning connection_id
    )
    update public.evotor_connections connection
    set status = 'error',
        last_error_at = ${now.toISOString()}::timestamptz,
        last_error_message = 'Предыдущая синхронизация была прервана и будет повторена автоматически.',
        failed_items = failed_items + 1,
        retry_count = retry_count + 1
    from (select distinct connection_id from recovered) stale
    where connection.id = stale.connection_id
      and connection.status in ('connected', 'error')
    returning connection.id
  `;
}

export async function findEvotorConnectionByUserId(userId: string) {
  const sql = getPostgresSql();
  const rows = await sql<{ id: string }[]>`
    select id from public.evotor_connections where evotor_user_id = ${userId} limit 1
  `;
  return rows[0]?.id ?? null;
}

export async function getEvotorConnectionOverview() {
  const sql = getPostgresSql();
  const rows = await sql<{
    id: string;
    status: string;
    installed_at: string;
    last_sync_at: string | null;
    last_success_at: string | null;
    last_error_at: string | null;
    last_error_message: string | null;
    last_event_received_at: string | null;
    last_sync_started_at: string | null;
    last_cursor_at: string | null;
    last_imported_receipts: number;
    last_updated_receipts: number;
    failed_items: number;
    retry_count: number;
    consecutive_failures: number;
    next_retry_at: string | null;
    stores_count: number;
    devices_count: number;
    receipts_count: number;
  }[]>`
    select c.id, c.status, c.installed_at, c.last_sync_at, c.last_success_at,
      c.last_error_at, c.last_error_message, c.last_event_received_at,
      c.last_sync_started_at, c.last_cursor_at, c.last_imported_receipts,
      c.last_updated_receipts, c.failed_items, c.retry_count,
      c.retry_count as consecutive_failures,
      coalesce(
        pending_retry.available_at,
        case when c.status = 'error' and c.last_error_at is not null then
          c.last_error_at + make_interval(
            secs => least(
              900,
              (30 * power(2, least(greatest(c.retry_count - 1, 0), 5)))::integer
            )
          )
        end
      ) as next_retry_at,
      (select count(*)::integer from public.evotor_stores s where s.connection_id = c.id) as stores_count,
      (select count(*)::integer from public.evotor_devices d where d.connection_id = c.id) as devices_count,
      (select count(*)::integer from public.evotor_receipts r where r.connection_id = c.id) as receipts_count
    from public.evotor_connections c
    left join lateral (
      select event.available_at
      from public.evotor_sync_events event
      where event.connection_id = c.id
        and event.status = 'pending'
      order by event.available_at
      limit 1
    ) pending_retry on true
    order by c.installed_at desc
  `;
  return rows;
}

export async function getEvotorAdminData() {
  const sql = getPostgresSql();
  const [connections, stores, devices, events, errors] = await Promise.all([
    getEvotorConnectionOverview(),
    sql<{
      id: string;
      connection_id: string;
      name: string;
      address: string | null;
      synchronized_at: string;
    }[]>`
      select id, connection_id, name, address, synchronized_at
      from public.evotor_stores order by name
    `,
    sql<{
      id: string;
      connection_id: string;
      store_id: string | null;
      name: string | null;
      status: string | null;
      device_model: string | null;
      synchronized_at: string;
    }[]>`
      select id, connection_id, store_id, name, status, device_model, synchronized_at
      from public.evotor_devices order by name nulls last
    `,
    sql<{
      id: string;
      connection_id: string;
      sync_type: string;
      status: string;
      requested_by: string;
      result_counts: Record<string, number>;
      imported_count: number;
      updated_count: number;
      failed_count: number;
      retry_count: number;
      cursor_before: string | null;
      cursor_after: string | null;
      created_at: string;
      finished_at: string | null;
    }[]>`
      select id, connection_id, sync_type, status, requested_by,
        result_counts, imported_count, updated_count, failed_count,
        retry_count, cursor_before, cursor_after, created_at, finished_at
      from public.evotor_sync_events order by created_at desc limit 20
    `,
    sql<{
      id: string;
      connection_id: string;
      message: string;
      http_status: number | null;
      retryable: boolean;
      created_at: string;
    }[]>`
      select id, connection_id, message, http_status, retryable, created_at
      from public.evotor_sync_errors order by created_at desc limit 10
    `
  ]);
  return { connections, stores, devices, events, errors };
}
