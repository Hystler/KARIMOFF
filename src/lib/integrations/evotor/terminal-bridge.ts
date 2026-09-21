import "server-only";

import { createHmac, randomBytes, randomInt } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";

const DEVICE_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PAIRING_CODE_PATTERN = /^\d{8}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;

export type TerminalBridgeDevice = {
  id: string;
  label: string;
  appVersion: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
};

function secret() {
  const value = process.env.EVOTOR_TERMINAL_BRIDGE_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("EVOTOR_TERMINAL_BRIDGE_SECRET is not configured.");
  return value;
}

function digest(namespace: string, value: string) {
  return createHmac("sha256", secret()).update(`${namespace}:${value}`).digest("hex");
}

export function terminalBridgeReady() {
  const bridgeSecret = process.env.EVOTOR_TERMINAL_BRIDGE_SECRET?.trim() ?? "";
  return process.env.EVOTOR_TERMINAL_BRIDGE_ENABLED === "true"
    && bridgeSecret.length >= 32;
}

export async function getTerminalBridgeDevices(
  locationIds: string[] | null = null
): Promise<TerminalBridgeDevice[]> {
  if (!terminalBridgeReady()) return [];
  if (locationIds !== null && !locationIds.length) return [];
  const sql = getPostgresSql();
  const rows = locationIds === null ? await sql<{
    id: string;
    label: string;
    app_version: string | null;
    paired_at: string | null;
    last_seen_at: string | null;
  }[]>`
    select id, label, app_version, paired_at, last_seen_at
    from public.evotor_terminal_devices
    where revoked_at is null and token_hash is not null
    order by paired_at desc nulls last, created_at desc
  ` : await sql<{
    id: string;
    label: string;
    app_version: string | null;
    paired_at: string | null;
    last_seen_at: string | null;
  }[]>`
    select id, label, app_version, paired_at, last_seen_at
    from public.evotor_terminal_devices
    where revoked_at is null
      and token_hash is not null
      and location_id = any(${locationIds}::uuid[])
    order by paired_at desc nulls last, created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    appVersion: row.app_version,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at
  }));
}

export async function getTerminalBridgeDeviceLocation(deviceId: string) {
  if (!terminalBridgeReady()) return null;
  const [device] = await getPostgresSql()<{ location_id: string }[]>`
    select location_id
    from public.evotor_terminal_devices
    where id = ${deviceId}::uuid and revoked_at is null
  `;
  return device?.location_id ?? null;
}

export async function createTerminalPairingCode(params: {
  locationId: string;
  staffId: string | null;
}) {
  if (!terminalBridgeReady()) throw new Error("Terminal bridge is disabled.");
  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await getPostgresSql().begin(async (sql) => {
    await sql`
      update public.evotor_terminal_pairing_codes
      set consumed_at = now()
      where consumed_at is null and expires_at <= now()
    `;
    await sql`
      insert into public.evotor_terminal_pairing_codes (
        location_id, code_hash, created_by_staff_id, expires_at
      ) values (
        ${params.locationId}::uuid,
        ${digest("pairing-code", code)},
        ${params.staffId}::uuid,
        ${expiresAt}::timestamptz
      )
    `;
  });
  return { code, expiresAt };
}

export async function pairTerminal(params: {
  code: string;
  deviceKey: string;
  label: string;
  appVersion: string;
}) {
  if (!terminalBridgeReady()) throw new Error("Terminal bridge is disabled.");
  if (!PAIRING_CODE_PATTERN.test(params.code) || !DEVICE_KEY_PATTERN.test(params.deviceKey)) return null;
  const label = params.label.trim().slice(0, 120) || "Эвотор";
  const appVersion = params.appVersion.trim().slice(0, 40) || null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest("device-token", token);

  return getPostgresSql().begin(async (sql) => {
    const [pairing] = await sql<{ id: string; location_id: string }[]>`
      select id, location_id
      from public.evotor_terminal_pairing_codes
      where code_hash = ${digest("pairing-code", params.code)}
        and consumed_at is null
        and expires_at > now()
      for update
    `;
    if (!pairing) return null;

    const [device] = await sql<{ id: string }[]>`
      insert into public.evotor_terminal_devices (
        location_id, device_key, label, token_hash, app_version, paired_at,
        last_seen_at, revoked_at, updated_at
      ) values (
        ${pairing.location_id}::uuid, ${params.deviceKey}, ${label}, ${tokenHash},
        ${appVersion}, now(), now(), null, now()
      )
      on conflict (device_key) do update
      set location_id = excluded.location_id,
          label = excluded.label,
          token_hash = excluded.token_hash,
          app_version = excluded.app_version,
          paired_at = now(),
          last_seen_at = now(),
          revoked_at = null,
          updated_at = now()
      returning id
    `;
    await sql`
      update public.evotor_terminal_pairing_codes
      set consumed_at = now()
      where id = ${pairing.id}::uuid
    `;
    return { token, deviceId: device.id };
  });
}

export async function authenticateTerminal(request: Request) {
  if (!terminalBridgeReady()) return null;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!TOKEN_PATTERN.test(token)) return null;
  const [device] = await getPostgresSql()<{
    id: string;
    location_id: string;
  }[]>`
    update public.evotor_terminal_devices
    set last_seen_at = now(), updated_at = now()
    where token_hash = ${digest("device-token", token)}
      and revoked_at is null
    returning id, location_id
  `;
  return device ?? null;
}

export async function queueSyntheticTerminalPreview(params: {
  deviceId: string;
  staffId: string | null;
}) {
  const payload = {
    schemaVersion: 1,
    orderId: `hosted-preview-${Date.now()}`,
    displayNumber: "Т-HTTPS",
    total: 560,
    items: [{ name: "Хот-дог Датский Свинина", quantity: 2, lineTotal: 560 }],
    comment: "Защищённая тестовая передача с сервера KARIMOFF"
  };
  const sql = getPostgresSql();
  const [job] = await sql<{ id: string }[]>`
    insert into public.evotor_terminal_preview_jobs (
      device_id, payload, created_by_staff_id
    )
    select id, ${sql.json(payload)}::jsonb, ${params.staffId}::uuid
    from public.evotor_terminal_devices
    where id = ${params.deviceId}::uuid and revoked_at is null
    returning id
  `;
  if (!job) throw new Error("Terminal not found.");
  return job.id;
}

export async function queueOrderTerminalPreview(params: {
  deviceId: string;
  orderId: string;
  staffId: string | null;
}) {
  return getPostgresSql().begin(async (sql) => {
    const [order] = await sql<{
      id: string;
      location_id: string;
      display_number: string | null;
      total: string | number;
      comment: string | null;
      is_test: boolean;
    }[]>`
      select id, location_id, display_number, total, comment, is_test
      from public.orders
      where id = ${params.orderId}::uuid and is_operational = true
    `;
    if (!order) throw new Error("Order not found.");
    if (!order.is_test && process.env.EVOTOR_TERMINAL_ALLOW_LIVE_PREVIEW !== "true") {
      throw new Error("Only test orders may be previewed.");
    }
    const items = await sql<{
      product_name: string;
      quantity: number;
      line_total: string | number;
    }[]>`
      select product_name, quantity, line_total
      from public.order_items
      where order_id = ${order.id}::uuid
      order by id
    `;
    if (!items.length) throw new Error("Order has no items.");
    const payload = {
      schemaVersion: 1,
      orderId: order.id,
      displayNumber: order.display_number || order.id.slice(0, 8),
      total: Number(order.total),
      items: items.map((item) => ({
        name: item.product_name,
        quantity: Number(item.quantity),
        lineTotal: Number(item.line_total)
      })),
      comment: order.comment || ""
    };
    const [job] = await sql<{ id: string }[]>`
      insert into public.evotor_terminal_preview_jobs (
        device_id, order_id, payload, created_by_staff_id
      )
      select device.id, ${order.id}::uuid, ${sql.json(payload)}::jsonb, ${params.staffId}::uuid
      from public.evotor_terminal_devices device
      where device.id = ${params.deviceId}::uuid
        and device.location_id = ${order.location_id}::uuid
        and device.revoked_at is null
      returning id
    `;
    if (!job) throw new Error("Terminal does not belong to the order location.");
    return job.id;
  });
}

export async function nextTerminalPreview(deviceId: string) {
  return getPostgresSql().begin(async (sql) => {
    await sql`
      update public.evotor_terminal_preview_jobs
      set status = 'expired', updated_at = now()
      where device_id = ${deviceId}::uuid
        and status in ('queued', 'delivered')
        and expires_at <= now()
    `;
    const [job] = await sql<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload
      from public.evotor_terminal_preview_jobs
      where device_id = ${deviceId}::uuid
        and status in ('queued', 'delivered')
        and expires_at > now()
      order by created_at
      limit 1
      for update skip locked
    `;
    if (!job) return null;
    await sql`
      update public.evotor_terminal_preview_jobs
      set status = 'delivered', delivered_at = coalesce(delivered_at, now()),
          delivery_attempts = delivery_attempts + 1, updated_at = now()
      where id = ${job.id}::uuid
    `;
    return job;
  });
}

export async function acknowledgeTerminalPreview(deviceId: string, jobId: string) {
  const rows = await getPostgresSql()<{ id: string }[]>`
    update public.evotor_terminal_preview_jobs
    set status = 'acknowledged', acknowledged_at = now(), updated_at = now()
    where id = ${jobId}::uuid
      and device_id = ${deviceId}::uuid
      and status = 'delivered'
    returning id
  `;
  return Boolean(rows[0]);
}
