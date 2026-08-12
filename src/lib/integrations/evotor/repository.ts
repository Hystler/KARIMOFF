import "server-only";

import { createHash } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";
import { encryptEvotorToken, fingerprintEvotorToken } from "./crypto";

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
  syncType: "manual" | "check" | "installation" | "uninstallation";
  requestedBy: string;
  idempotencyKey?: string;
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
      ${params.requestedBy}, now() - interval '7 days', now()
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
    stores_count: number;
    devices_count: number;
    receipts_count: number;
  }[]>`
    select c.id, c.status, c.installed_at, c.last_sync_at, c.last_success_at,
      c.last_error_at, c.last_error_message,
      (select count(*)::integer from public.evotor_stores s where s.connection_id = c.id) as stores_count,
      (select count(*)::integer from public.evotor_devices d where d.connection_id = c.id) as devices_count,
      (select count(*)::integer from public.evotor_receipts r where r.connection_id = c.id) as receipts_count
    from public.evotor_connections c
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
      created_at: string;
      finished_at: string | null;
    }[]>`
      select id, connection_id, sync_type, status, requested_by,
        result_counts, created_at, finished_at
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
