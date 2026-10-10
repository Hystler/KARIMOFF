import postgres from "postgres";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEST_CHAT_ID_ENV = "TELEGRAM_SAFE_TEST_CHAT_ID";
const EXPECTED_BOT_ENV = "TELEGRAM_EXPECTED_BOT_USERNAME";
const SAFE_CHAT_ID = /^[1-9][0-9]{0,15}$/;
const QUEUE_PROVIDERS = ["telegram", "max"];
const QUEUE_STATUSES = ["pending", "processing", "retry", "sent", "permanent_failure", "superseded"];

function getOrderUrl() {
  try {
    const origin = new URL(process.env.APP_ORIGIN?.trim() ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password) return null;
    return new URL("/profile/orders", origin.origin).toString();
  } catch {
    return null;
  }
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function isSafeChatId(value) {
  return typeof value === "string" && SAFE_CHAT_ID.test(value) && Number.isSafeInteger(Number(value));
}

async function requestBot(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, reason: "token_missing" };

  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" } : { method: "GET" }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    return {
      ok: false,
      reason: method === "sendMessage" ? "outcome_unknown_do_not_retry" : "network_unavailable"
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const code = Number.isInteger(payload?.error_code) ? payload.error_code : response.status;
    return {
      ok: false,
      reason: method === "sendMessage" && (payload === null || code === 408 || code >= 500) ? "outcome_unknown_do_not_retry"
        : code === 401 ? "token_rejected"
          : method === "sendMessage" && (code === 403 || code === 400) ? "recipient_or_permission_rejected"
            : code === 429 ? "rate_limited"
              : code >= 500 ? "provider_unavailable" : "provider_rejected"
    };
  }
  return { ok: true, payload };
}

async function inspectBot() {
  const result = await requestBot("getMe");
  if (!result.ok) return { reachable: false, reason: result.reason, username: null, expectedUsernameMatches: false };

  const bot = result.payload.result;
  const username = typeof bot?.username === "string" ? bot.username : null;
  const expectedUsername = normalizeUsername(process.env[EXPECTED_BOT_ENV]);
  const expectedUsernameMatches = !expectedUsername || normalizeUsername(username) === expectedUsername;
  return {
    reachable: bot?.is_bot === true && Boolean(username),
    reason: bot?.is_bot === true && username ? null : "invalid_bot_identity",
    username,
    expectedUsernameConfigured: Boolean(expectedUsername),
    expectedUsernameMatches
  };
}

async function inspectDatabase(chatId) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return { available: false, reason: "database_url_missing", queues: null, recipientLinked: null };

  let sql;
  try {
    sql = postgres(databaseUrl, {
      connect_timeout: 10,
      idle_timeout: 5,
      max: 1,
      prepare: false,
      connection: {
        application_name: "karimoff-telegram-notification-preflight",
        default_transaction_read_only: true
      }
    });
    const rows = await sql`
      select provider, status,
        count(*)::int as count,
        count(*) filter (where status in ('pending', 'retry') and available_at <= now())::int as due,
        count(*) filter (where status in ('pending', 'retry') and created_at < now() - interval '24 hours')::int as older_than_24h,
        count(*) filter (where status = 'processing'
          and (locked_at is null or locked_at < now() - interval '5 minutes'))::int as stale_locks
      from public.order_notification_deliveries
      group by provider, status
    `;

    let recipientLinked = null;
    if (chatId && isSafeChatId(chatId)) {
      const [recipient] = await sql`
        select count(*)::int as matches
        from public.user_identities identity_row
        join public.customers customer_row on customer_row.id = identity_row.user_id
        where identity_row.provider = 'telegram'
          and identity_row.metadata->>'telegramBotUserId' = ${chatId}
      `;
      recipientLinked = recipient?.matches === 1;
    } else if (chatId) {
      recipientLinked = false;
    }

    const queues = Object.fromEntries(QUEUE_PROVIDERS.map((provider) => [
      provider,
      Object.assign(Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0])), {
        due: 0,
        olderThan24h: 0,
        staleLocks: 0
      })
    ]));
    for (const row of rows) {
      const queue = queues[row.provider];
      if (!queue) continue;
      if (Object.hasOwn(queue, row.status)) queue[row.status] = row.count;
      queue.due += row.due;
      queue.olderThan24h += row.older_than_24h;
      queue.staleLocks += row.stale_locks;
    }
    return { available: true, reason: null, queues, recipientLinked };
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "";
    return {
      available: false,
      reason: code === "42P01" || code === "42703" ? "schema_missing" : "database_unavailable",
      queues: null,
      recipientLinked: null
    };
  } finally {
    await sql?.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function confirmOneMessage(chatId, botUsername) {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const suffix = chatId.slice(-4);
  const confirmation = `SEND ONCE ${suffix}`;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      `This sends one test message from @${botUsername} to the linked test account ending in ${suffix}. Type "${confirmation}" to continue: `
    );
    return answer.trim() === confirmation;
  } finally {
    prompt.close();
  }
}

async function sendOneSmokeTest(chatId, orderUrl) {
  const testOrderNumber = `TEST-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  const result = await requestBot("sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "Открыть личный кабинет", url: orderUrl }]] },
    text: `ТЕСТ KARIMOFF. Заказ ${testOrderNumber} готов к выдаче. Реального заказа нет.`
  });
  if (!result.ok) return { accepted: false, reason: result.reason };

  const messageId = result.payload.result?.message_id;
  return Number.isInteger(messageId) && messageId > 0
    ? { accepted: true, reason: null }
    : { accepted: false, reason: "outcome_unknown_do_not_retry" };
}

export async function runPreflight({ sendOnce = false } = {}) {
  const chatId = process.env[TEST_CHAT_ID_ENV]?.trim() ?? "";
  const orderUrl = getOrderUrl();
  const notificationsEnabled = process.env.ORDER_STATUS_NOTIFICATIONS_ENABLED === "true";
  const maintenance = process.env.MAINTENANCE_MODE === "true";
  const maxTokenConfigured = Boolean(process.env.MAX_BOT_TOKEN?.trim());
  const expectedUsernameConfigured = Boolean(normalizeUsername(process.env[EXPECTED_BOT_ENV]));

  const [bot, database] = await Promise.all([inspectBot(), inspectDatabase(chatId)]);
  const queues = database.queues;
  const queuesAreClear = queues
    ? QUEUE_PROVIDERS.every((provider) => {
        const queue = queues[provider];
        return queue.pending + queue.retry + queue.processing === 0 && queue.staleLocks === 0;
      })
    : null;
  const queueAndConfigPreflightPassed = Boolean(
    !notificationsEnabled && !maintenance && orderUrl && bot.reachable
      && bot.expectedUsernameMatches && database.available && maxTokenConfigured
      && queuesAreClear === true
  );
  const testReady = Boolean(
    !notificationsEnabled && !maintenance && orderUrl && bot.reachable
      && bot.expectedUsernameMatches && expectedUsernameConfigured
      && database.available && database.recipientLinked === true
  );

  const result = {
    bot,
    worker: { notificationsEnabled, maintenance, maxTokenConfigured },
    appOrderLinkConfigured: Boolean(orderUrl),
    databaseAvailable: database.available,
    notificationQueues: database.queues,
    telegramRecipientLinked: database.recipientLinked,
    queueAndConfigPreflightPassed,
    oneMessageTestReady: testReady,
    messageSent: false
  };

  if (!sendOnce) return result;
  if (!testReady) return { ...result, sendResult: { accepted: false, reason: "preflight_blocked" } };
  if (!await confirmOneMessage(chatId, bot.username)) {
    return { ...result, sendResult: { accepted: false, reason: "confirmation_missing" } };
  }

  const sendResult = await sendOneSmokeTest(chatId, orderUrl);
  return { ...result, messageSent: sendResult.accepted, sendResult };
}

function safeToPrint(value) {
  return JSON.stringify(value, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sendOnce = process.argv.includes("--send-once");
  try {
    const result = await runPreflight({ sendOnce });
    console.log(safeToPrint(result));
    if (!result.bot.reachable || !result.databaseAvailable) process.exitCode = 1;
    else if (sendOnce && !result.messageSent) process.exitCode = 1;
    else if (!sendOnce && !result.queueAndConfigPreflightPassed) process.exitCode = 2;
  } catch {
    console.error('{"error":"preflight_failed","details":"redacted"}');
    process.exitCode = 1;
  }
}
