import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("transactional Telegram and MAX notifications are queued exactly once and disabled by default", () => {
  const migration = read("database/migrations/20260828220000_add_order_status_notifications.sql");
  const maxAccessMigration = read("database/migrations/20261010101500_add_max_bot_recipient_access.sql");
  const provider = read("src/lib/notifications/order-status/provider.ts");
  const service = read("src/lib/notifications/order-status/service.ts");
  const maxWebhook = read("src/app/api/integrations/max/webhook/route.ts");
  const canary = read("scripts/max-notification-canary.mjs");
  const scheduler = read("src/lib/notifications/order-status/scheduler.ts");
  const instrumentation = read("src/instrumentation.ts");
  const env = read(".env.example");
  const dockerIgnore = read(".dockerignore");

  assert.match(migration, /unique \(order_id, identity_id, event_type\)/);
  assert.match(migration, /new\.to_status not in \('ready', 'cancelled'\)/);
  assert.match(migration, /order_row\.is_test = false/);
  assert.match(migration, /identity_row\.provider in \('telegram', 'max'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(maxAccessMigration, /identity_id uuid primary key references public\.user_identities/);
  assert.match(maxAccessMigration, /revoke all privileges on table public\.max_bot_recipient_access from public/);
  assert.match(maxWebhook, /x-max-bot-api-secret/);
  assert.match(maxWebhook, /bot_started.*bot_stopped.*dialog_removed/s);
  assert.match(service, /access\.can_send/);
  assert.match(provider, /https:\/\/api\.telegram\.org\/bot\$\{token\}\/sendMessage/);
  assert.match(provider, /https:\/\/platform-api2\.max\.ru\/messages/);
  assert.match(provider, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(provider, /TELEGRAM_OIDC_CLIENT_SECRET/);
  assert.match(service, /for update skip locked/);
  assert.match(service, /attempts >= 8/);
  assert.match(service, /ORDER_STATUS_NOTIFICATIONS_ENABLED === "true"/);
  assert.match(scheduler, /setInterval\(\(\) => void run\(state\), 10_000\)/);
  assert.match(instrumentation, /startOrderNotificationScheduler/);
  assert.match(env, /^ORDER_STATUS_NOTIFICATIONS_ENABLED=false$/m);
  assert.match(env, /^TELEGRAM_BOT_TOKEN=$/m);
  assert.match(env, /^MAX_BOT_WEBHOOK_SECRET=$/m);
  assert.match(env, /^MAX_NOTIFICATION_TEST_SEND_ENABLED=false$/m);
  assert.match(canary, /default_transaction_read_only: true/);
  assert.match(canary, /--confirm-recipient=/);
  assert.match(dockerIgnore, /!database\/migrations\/\*\.sql/);
});
