import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const bridge = read("src/lib/integrations/evotor/terminal-bridge.ts");
const healthRoute = read("src/app/api/terminal/health/route.ts");
const pairRoute = read("src/app/api/terminal/pair/route.ts");
const nextRoute = read("src/app/api/terminal/orders/next/route.ts");
const ackRoute = read("src/app/api/terminal/orders/[id]/ack/route.ts");
const migration = read("supabase/migrations/20260921193000_add_evotor_terminal_bridge.sql");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const dockerfile = read("Dockerfile");
const manifest = read("android/evotor-bridge/app/src/main/AndroidManifest.xml");
const activity = read("android/evotor-bridge/app/src/main/java/ru/karimoff/evotor/bridge/MainActivity.java");
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
  assert.match(dockerfile, /20260921193000_add_evotor_terminal_bridge\.sql/);
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
  assert.match(bridge, /where device_id = \$\{deviceId\}::uuid/);
  assert.match(bridge, /and device_id = \$\{deviceId\}::uuid/);
  assert.match(bridge, /!order\.is_test && process\.env\.EVOTOR_TERMINAL_ALLOW_LIVE_PREVIEW !== "true"/);
  assert.match(bridge, /Only test orders may be previewed/);
  assert.match(bridge, /device\.location_id = \$\{order\.location_id\}::uuid/);
});

test("Evotor APK uses hosted HTTPS pairing without cleartext or fiscal actions", () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /usesCleartextTraffic="true"/);
  assert.match(strings, /https:\/\/karimoff\.site\/api\/terminal/);
  assert.match(activity, /getSharedPreferences\(PREFERENCES, MODE_PRIVATE\)/);
  assert.match(activity, /"Authorization", "Bearer " \+ token/);
  assert.match(activity, /\/orders\/next/);
  assert.match(activity, /\/orders\/" \+ jobId \+ "\/ack/);
  assert.doesNotMatch(activity, /ReceiptApi|PaymentIntent|SellApi|PaybackApi/);
});
