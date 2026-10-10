import { z } from "zod";
import { safeSecretEqual } from "@/lib/auth/social/crypto";
import { parseMaxUserId } from "@/lib/auth/social/max-protocol";
import { getPostgresSql } from "@/lib/postgres/server";
import { getMaxBotWebhookSecret } from "@/lib/notifications/order-status/configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const envelopeSchema = z.object({
  update_type: z.string().min(1).max(64),
  timestamp: z.number().int().positive().safe()
}).passthrough();

const accessUpdateSchema = z.object({
  update_type: z.enum(["bot_started", "bot_stopped", "dialog_removed"]),
  timestamp: z.number().int().positive().safe(),
  chat_id: z.number().int().positive().safe(),
  user: z.object({ user_id: z.union([z.number().int().positive().safe(), z.string().max(32)]) })
}).passthrough();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const secret = getMaxBotWebhookSecret();
  if (!secret) return json({ ok: false, error: "webhook_unavailable" }, 503);
  if (!safeSecretEqual(request.headers.get("x-max-bot-api-secret") ?? "", secret)) {
    return json({ ok: false, error: "forbidden" }, 401);
  }

  const body = await request.text().catch(() => "");
  if (!body || body.length > 32_768) return json({ ok: false, error: "invalid_update" }, 400);
  let candidate: unknown;
  try {
    candidate = JSON.parse(body);
  } catch {
    return json({ ok: false, error: "invalid_update" }, 400);
  }

  const envelope = envelopeSchema.safeParse(candidate);
  if (!envelope.success) return json({ ok: false, error: "invalid_update" }, 400);
  if (!["bot_started", "bot_stopped", "dialog_removed"].includes(envelope.data.update_type)) {
    return json({ ok: true, ignored: true });
  }

  const parsed = accessUpdateSchema.safeParse(candidate);
  if (!parsed.success) return json({ ok: true, ignored: true });
  const providerUserId = parseMaxUserId(parsed.data.user.user_id);
  if (!providerUserId) return json({ ok: true, ignored: true });

  const canSend = parsed.data.update_type === "bot_started";
  const sql = getPostgresSql();
  try {
    await sql`
      insert into public.max_bot_recipient_access (
        identity_id, can_send, last_event_type, last_event_timestamp_ms
      )
      select identity_row.id, ${canSend}, ${parsed.data.update_type}, ${parsed.data.timestamp}
      from public.user_identities identity_row
      where identity_row.provider = 'max'
        and identity_row.provider_user_id = ${providerUserId}
      on conflict (identity_id) do update
      set can_send = case
            when excluded.last_event_timestamp_ms > max_bot_recipient_access.last_event_timestamp_ms
              then excluded.can_send
            when excluded.last_event_timestamp_ms = max_bot_recipient_access.last_event_timestamp_ms
              then max_bot_recipient_access.can_send and excluded.can_send
            else max_bot_recipient_access.can_send
          end,
          last_event_type = case
            when excluded.last_event_timestamp_ms > max_bot_recipient_access.last_event_timestamp_ms
              then excluded.last_event_type
            when excluded.last_event_timestamp_ms = max_bot_recipient_access.last_event_timestamp_ms
              and not excluded.can_send then excluded.last_event_type
            else max_bot_recipient_access.last_event_type
          end,
          last_event_timestamp_ms = greatest(
            max_bot_recipient_access.last_event_timestamp_ms,
            excluded.last_event_timestamp_ms
          ),
          updated_at = now()
      where excluded.last_event_timestamp_ms >= max_bot_recipient_access.last_event_timestamp_ms
    `;
  } catch {
    return json({ ok: false, error: "temporarily_unavailable" }, 503);
  }

  return json({ ok: true });
}
