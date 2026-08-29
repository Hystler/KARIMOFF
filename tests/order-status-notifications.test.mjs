import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("transactional Telegram and MAX notifications are queued exactly once and disabled by default", () => {
  const migration = read("supabase/migrations/20260828220000_add_order_status_notifications.sql");
  const provider = read("src/lib/notifications/order-status/provider.ts");
  const service = read("src/lib/notifications/order-status/service.ts");
  const scheduler = read("src/lib/notifications/order-status/scheduler.ts");
  const instrumentation = read("src/instrumentation.ts");
  const env = read(".env.example");
  const dockerIgnore = read(".dockerignore");

  assert.match(migration, /unique \(order_id, identity_id, event_type\)/);
  assert.match(migration, /new\.to_status not in \('ready', 'cancelled'\)/);
  assert.match(migration, /order_row\.is_test = false/);
  assert.match(migration, /identity_row\.provider in \('telegram', 'max'\)/);
  assert.match(migration, /enable row level security/);
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
  assert.match(dockerIgnore, /!supabase\/migrations\/20260828220000_add_order_status_notifications\.sql/);
});
