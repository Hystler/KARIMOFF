import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const bridge = read("src/lib/integrations/evotor/terminal-bridge.ts");
const healthRoute = read("src/app/api/terminal/health/route.ts");
const pairRoute = read("src/app/api/terminal/pair/route.ts");
const nextRoute = read("src/app/api/terminal/orders/next/route.ts");
const ackRoute = read("src/app/api/terminal/orders/[id]/ack/route.ts");
const migration = read("database/migrations/20260921193000_add_evotor_terminal_bridge.sql");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const dockerfile = read("Dockerfile");
const manifest = read("android/evotor-bridge/app/src/main/AndroidManifest.xml");
const activity = read("android/evotor-bridge/app/src/main/java/ru/karimoff/evotor/bridge/MainActivity.java");
const pollingService = read("android/evotor-bridge/app/src/main/java/ru/karimoff/evotor/bridge/BridgePollingService.java");
const strings = read("android/evotor-bridge/app/src/main/res/values/strings.xml");

test("terminal bridge storage is private, scoped, and included in runtime startup", () => {
  assert.match(migration, /create table if not exists public\.evotor_terminal_devices/);
  assert.match(migration, /create table if not exists public\.evotor_terminal_pairing_codes/);
  assert.match(migration, /create table if not exists public\.evotor_terminal_preview_jobs/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /array\['anon', 'authenticated'\]/);
  assert.match(migration, /revoke all on table public\.evotor_terminal_devices from %I/);
  assert.match(migration, /revoke all on table public\.evotor_terminal_pairing_codes from %I/);
  assert.match(migration, /revoke all on table public\.evotor_terminal_preview_jobs from %I/);
  assert.match(runtimeMigrations, /20260921193000_add_evotor_terminal_bridge/);
  assert.match(dockerfile, /database\/migrations/);
});

test("pairing is one-time, rate-limited, and stores only token digests", () => {
  assert.match(pairRoute, /export async function POST/);
  assert.doesNotMatch(pairRoute, /export async function GET/);
  assert.match(pairRoute, /consumeEvotorRateLimit\(request, "terminal-pair", 10\)/);
  assert.match(bridge, /randomInt\(0, 100_000_000\)/);
  assert.match(bridge, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(bridge, /digest\("device-token", token\)/);
  assert.match(bridge, /set consumed_at = now\(\)/);
  assert.doesNotMatch(pairRoute, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(migration, /\bdevice_token\b/);
});

test("terminal health check is read-only and uses an Evotor-supported method", () => {
  assert.match(healthRoute, /export async function GET/);
  assert.doesNotMatch(healthRoute, /export async function (POST|PUT|DELETE)/);
  assert.match(healthRoute, /mode: "read-only"/);
  assert.match(healthRoute, /terminalBridgeReady\(\)/);
});

test("terminal jobs are device-scoped and live order previews require an explicit switch", () => {
  assert.match(nextRoute, /authenticateTerminal\(request\)/);
  assert.match(ackRoute, /authenticateTerminal\(request\)/);
  assert.match(bridge, /x-karimoff-terminal-token/);
  assert.doesNotMatch(bridge, /authorization\.slice\(7\)/);
  assert.match(bridge, /where device_id = \$\{deviceId\}::uuid/);
  assert.match(bridge, /and device_id = \$\{deviceId\}::uuid/);
  assert.match(bridge, /!order\.is_test && process\.env\.EVOTOR_TERMINAL_ALLOW_LIVE_PREVIEW !== "true"/);
  assert.match(bridge, /Only test orders may be previewed/);
  assert.match(bridge, /device\.location_id = \$\{order\.location_id\}::uuid/);
});

test("Evotor APK keeps hosted pairing separate from terminal payment requests", () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /usesCleartextTraffic="true"/);
  assert.match(strings, /https:\/\/karimoff\.site\/api\/terminal/);
  assert.match(activity, /getSharedPreferences\(PREFERENCES, MODE_PRIVATE\)/);
  assert.match(activity, /"X-Karimoff-Terminal-Token", token/);
  assert.doesNotMatch(activity, /setRequestProperty\("Authorization"/);
  assert.match(activity, /\/orders\/next/);
  assert.match(activity, /\/orders\/" \+ jobId \+ "\/ack/);
  assert.match(pollingService, /\/payments\/next/);
  assert.match(activity, /SellApi\.INSTANCE\.moveCurrentReceiptDraftToPaymentStage/);
  assert.doesNotMatch(healthRoute, /ReceiptApi|SellApi|PaybackApi/);
});

test("POS polling belongs to a sticky foreground service, not the Activity lifecycle", () => {
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_SPECIAL_USE/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android:foregroundServiceType="specialUse"/);
  assert.match(manifest, /android\.app\.PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
  assert.match(manifest, /android:exported="false"/);
  assert.match(pollingService, /startForegroundCompat\(buildNotification/);
  assert.match(pollingService, /return START_STICKY/);
  assert.match(pollingService, /PENDING_PAYMENT_JOB_KEY/);
  assert.match(pollingService, /STATUS_OPERATION_PENDING/);
  assert.match(pollingService, /STATUS_PAYMENT_WAITING/);
  assert.match(pollingService, /hasFinalServerResult\(activeReceipt\)/);
  assert.match(pollingService, /preferences\.edit\(\)\.remove\(ACTIVE_RECEIPT_KEY\)\.commit\(\)/);
  assert.match(pollingService, /Math\.min\(retryDelayMs \* 2, MAX_RETRY_DELAY_MS\)/);
  assert.match(pollingService, /scheduleRetry\(STATUS_PAIRING_REQUIRED\)/);
  assert.match(pollingService, /PendingIntent\.getActivity/);
  assert.doesNotMatch(pollingService, /SellApi|moveCurrentReceiptDraftToPaymentStage/);
  assert.match(pollingService, /claimedJobPersistenceFailed/);
  assert.match(pollingService, /PENDING_PAYMENT_JOB_KEY\).*commit\(\)/s);
  assert.match(pollingService, /ACTIVE_RECEIPT_KEY.*PENDING_PAYMENT_RESULT_KEY/s);
  assert.match(pollingService, /ReceiptApi\.getReceipt\(this, Receipt\.Type\.SELL\)/);
  assert.match(pollingService, /setRequestProperty\("X-Karimoff-Terminal-Token", token\)/);
  const onPause = activity.slice(activity.indexOf("protected void onPause()"), activity.indexOf("protected void onNewIntent"));
  assert.doesNotMatch(onPause, /paymentPollingEnabled = false|removeCallbacks/);
  assert.doesNotMatch(activity, /\/payments\/next/);
  assert.match(activity, /startForegroundService\(service\)/);
  assert.match(activity, /ACTION_PAYMENT_JOB_AVAILABLE/);
  assert.match(activity, /background_service_status/);
  assert.match(activity, /background_service_notification_disabled/);
  assert.match(activity, /areNotificationsEnabled\(\)/);
  assert.match(activity, /clearPendingPaymentJob\(intentId\)/);
  assert.match(activity, /markServerFinalStatus\(intentId, finalStatus\)/);
  assert.match(activity, /if \(!clearPendingPaymentJob\(intentId\)\)/);
  assert.match(activity, /if \(!activityResumed \|\| !paymentPollingEnabled/);
  assert.match(activity, /intentId\.equals\(handledPaymentJobId\)/);

  const cacheJob = pollingService.indexOf(".putString(PENDING_PAYMENT_JOB_KEY, envelope.toString())");
  const persistJob = pollingService.indexOf(".commit();", cacheJob);
  const broadcastJob = pollingService.indexOf("ACTION_PAYMENT_JOB_AVAILABLE", persistJob);
  assert.ok(cacheJob >= 0 && persistJob > cacheJob && broadcastJob > persistJob,
    "claimed server job must be durably cached before the Activity is notified");
  const resultHandling = activity.slice(activity.indexOf("if (resultAccepted)"), activity.indexOf("private void pairTerminal()"));
  assert.doesNotMatch(resultHandling, /remove\(ACTIVE_RECEIPT_KEY\)/,
    "keep the active receipt lock until the service confirms the cached job was removed");
});
