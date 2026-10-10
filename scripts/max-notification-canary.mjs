import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const INT64_MAX = "9223372036854775807";
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{5,256}$/;

export class MaxCanaryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function normalizeMaxRecipientId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  return value.length === 19 && value > INT64_MAX ? null : value;
}

export function validateCanaryInvocation(env, args) {
  const preflightOnly = args.length === 1 && args[0] === "--preflight-only";
  const confirmation = args.length === 1 && args[0].startsWith("--confirm-recipient=")
    ? args[0].slice("--confirm-recipient=".length)
    : null;
  if (!preflightOnly && !confirmation) throw new MaxCanaryError("explicit_confirmation_required");

  const allowedRecipient = normalizeMaxRecipientId(env.MAX_NOTIFICATION_TEST_RECIPIENT_ID);
  if (!allowedRecipient) throw new MaxCanaryError("test_recipient_not_configured");
  if (confirmation && confirmation !== allowedRecipient) throw new MaxCanaryError("recipient_confirmation_mismatch");
  if (confirmation && env.MAX_NOTIFICATION_TEST_SEND_ENABLED !== "true") {
    throw new MaxCanaryError("test_send_disabled");
  }
  if (env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true") {
    throw new MaxCanaryError("notification_worker_must_be_disabled");
  }
  if (env.MAINTENANCE_MODE === "true") throw new MaxCanaryError("maintenance_mode_enabled");

  return { mode: preflightOnly ? "preflight" : "send", recipientId: allowedRecipient };
}

function getReturnUrl(value) {
  try {
    const origin = new URL(value?.trim() ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password) return null;
    return new URL("/profile/orders", origin.origin).toString();
  } catch {
    return null;
  }
}

function requiredEnvironment(env, invocation) {
  const returnUrl = getReturnUrl(env.APP_ORIGIN);
  if (!returnUrl) throw new MaxCanaryError("app_origin_not_configured");
  if (!env.DATABASE_URL) throw new MaxCanaryError("database_not_configured");
  if (!env.MAX_BOT_TOKEN?.trim()) throw new MaxCanaryError("max_token_not_configured");
  if (!WEBHOOK_SECRET_PATTERN.test(env.MAX_BOT_WEBHOOK_SECRET?.trim() ?? "")) {
    throw new MaxCanaryError("max_webhook_secret_not_configured");
  }
  const botName = env.MAX_BOT_NAME?.trim().replace(/^@/, "").toLowerCase();
  if (!botName) throw new MaxCanaryError("max_bot_name_not_configured");
  return { ...invocation, botName, returnUrl };
}

async function assertAuthorizedRecipient(env, recipientId) {
  const sql = postgres(env.DATABASE_URL, {
    application_name: "karimoff-max-notification-canary",
    connect_timeout: 5,
    idle_timeout: 1,
    max: 1,
    prepare: false,
    connection: { default_transaction_read_only: true }
  });
  try {
    const [row] = await sql`
      select (
        exists (
          select 1 from public.user_identities identity_row
          where identity_row.provider = 'max'
            and identity_row.provider_user_id = ${recipientId}
            and exists (
              select 1 from public.max_bot_recipient_access access
              where access.identity_id = identity_row.id
                and access.can_send and access.last_event_type = 'bot_started'
            )
        )
      ) as authorized
    `;
    if (row?.authorized !== true) throw new MaxCanaryError("test_recipient_not_authorized");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function verifyBot(env, botName) {
  let response;
  try {
    response = await fetch("https://platform-api2.max.ru/me", {
      cache: "no-store",
      headers: { Authorization: env.MAX_BOT_TOKEN.trim() },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new MaxCanaryError("max_bot_api_unavailable");
  }
  if (!response.ok) throw new MaxCanaryError(`max_bot_api_http_${response.status}`);
  const payload = await response.json().catch(() => null);
  if (payload?.is_bot !== true || typeof payload.username !== "string"
      || payload.username.replace(/^@/, "").toLowerCase() !== botName) {
    throw new MaxCanaryError("max_bot_identity_mismatch");
  }
}

async function sendCanary(env, recipientId, returnUrl) {
  const url = new URL("https://platform-api2.max.ru/messages");
  url.searchParams.set("user_id", recipientId);
  let response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        attachments: [{
          payload: { buttons: [[{ text: "Открыть личный кабинет", type: "link", url: returnUrl }]] },
          type: "inline_keyboard"
        }],
        text: "Тестовое уведомление KARIMOFF: проверка доставки MAX. Это сообщение не относится к заказу."
      }),
      cache: "no-store",
      headers: { Authorization: env.MAX_BOT_TOKEN.trim(), "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new MaxCanaryError("max_test_send_outcome_unknown");
  }
  if (!response.ok) throw new MaxCanaryError(`max_test_send_rejected_http_${response.status}`);
  const payload = await response.json().catch(() => null);
  if (typeof payload?.message?.body?.mid !== "string" || !payload.message.body.mid.trim()) {
    throw new MaxCanaryError("max_test_send_outcome_unknown");
  }
}

async function main() {
  try {
    const invocation = validateCanaryInvocation(process.env, process.argv.slice(2));
    const config = requiredEnvironment(process.env, invocation);
    await assertAuthorizedRecipient(process.env, config.recipientId);
    await verifyBot(process.env, config.botName);
    if (config.mode === "preflight") {
      console.log("MAX canary preflight passed. No message sent.");
      return;
    }
    await sendCanary(process.env, config.recipientId, config.returnUrl);
    console.log("One MAX canary message was accepted. No retry was attempted.");
  } catch (error) {
    const code = error instanceof MaxCanaryError ? error.code : "max_canary_preflight_failed";
    console.error(`MAX canary stopped: ${code}. No automatic retry was attempted.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
