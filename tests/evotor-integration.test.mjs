import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const callback = read("src/app/api/integrations/evotor/token/route.ts");
const callbackAuth = read("src/lib/integrations/evotor/auth.ts");
const repository = read("src/lib/integrations/evotor/repository.ts");
const sync = read("src/lib/integrations/evotor/sync.ts");
const migration = read("supabase/migrations/20260812190000_add_evotor_cloud_integration.sql");
const adminAction = read("src/app/admin/integrations/evotor/actions.ts");

function runTypeScript(source) {
  const result = spawnSync(process.execPath, [
    "--conditions=react-server",
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    source
  ], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    env: {
      ...process.env,
      EVOTOR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function testModule(path, { removeTypeImport = false } = {}) {
  const cacheDirectory = join(process.cwd(), ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-evotor-test-"));
  const file = join(directory, "module.ts");
  let source = read(path).replace('import "server-only";\n', "");
  if (source.includes('from "./errors"')) {
    source = source.replace('from "./errors"', 'from "./errors.ts"');
    writeFileSync(join(directory, "errors.ts"), read("src/lib/integrations/evotor/errors.ts"));
  }
  if (removeTypeImport) {
    source = source.replace(/import type \{ EvotorDocument, EvotorReceipt \} from "\.\/types";\n/, "");
  }
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(file, source);
  return {
    url: pathToFileURL(file).href,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

test("token callback is POST-only, authenticated, rate-limited, deferred, and token-safe", () => {
  assert.match(callback, /export async function POST/);
  assert.doesNotMatch(callback, /export async function GET/);
  assert.match(callback, /verifyEvotorWebhookAuthorization/);
  assert.match(callback, /consumeEvotorRateLimit/);
  assert.match(callback, /after\(async \(\) =>/);
  assert.match(callback, /NextResponse\.json\(\{ ok: true \}/);
  assert.doesNotMatch(callback, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(callback, /token:\s*payload\.data\.token/);
  assert.match(callbackAuth, /authorization\.slice\(7\)/);
  assert.match(callbackAuth, /timingSafeEqual/);
});

test("application tokens are encrypted and authenticated before storage", () => {
  const fixture = testModule("src/lib/integrations/evotor/crypto.ts");
  let result;
  try {
    result = runTypeScript(`
      const { encryptEvotorToken, decryptEvotorToken, fingerprintEvotorToken } = await import(${JSON.stringify(fixture.url)});
      const token = "application-token-for-test-only";
      const encrypted = encryptEvotorToken(token);
      console.log(JSON.stringify({
        decrypted: decryptEvotorToken(encrypted),
        encrypted,
        fingerprintA: fingerprintEvotorToken(token),
        fingerprintB: fingerprintEvotorToken(token)
      }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.decrypted, "application-token-for-test-only");
  assert.notEqual(result.encrypted, result.decrypted);
  assert.equal(result.fingerprintA, result.fingerprintB);
});

test("Evotor client does not retry 401 and retries 429/500 only as safe GET", () => {
  const fixture = testModule("src/lib/integrations/evotor/client.ts");
  let result;
  try {
    result = runTypeScript(`
    const { EvotorClient } = await import(${JSON.stringify(fixture.url)});
    const { z } = await import("zod");
    let unauthorizedCalls = 0;
    const unauthorized = new EvotorClient("safe-test-token", {
      fetchImpl: async () => { unauthorizedCalls += 1; return new Response("{}", { status: 401 }); },
      sleep: async () => {}
    });
    let unauthorizedStatus = 0;
    try { await unauthorized.get("/stores/one", z.object({})); } catch (error) { unauthorizedStatus = error.status; }

    let rateCalls = 0;
    const rateLimited = new EvotorClient("safe-test-token", {
      fetchImpl: async () => {
        rateCalls += 1;
        return rateCalls === 1
          ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
          : Response.json({ ok: true });
      },
      sleep: async () => {}
    });
    await rateLimited.get("/stores/one", z.object({ ok: z.boolean() }));

    let serverCalls = 0;
    const serverError = new EvotorClient("safe-test-token", {
      fetchImpl: async () => { serverCalls += 1; return new Response("{}", { status: 500 }); },
      sleep: async () => {}
    });
    let serverStatus = 0;
    try { await serverError.get("/stores/one", z.object({})); } catch (error) { serverStatus = error.status; }

    let timeoutCalls = 0;
    const timeout = new EvotorClient("safe-test-token", {
      fetchImpl: async () => {
        timeoutCalls += 1;
        const error = new Error("synthetic timeout");
        error.name = "TimeoutError";
        throw error;
      },
      sleep: async () => {}
    });
    let timeoutResult = null;
    try { await timeout.get("/stores/one", z.object({})); } catch (error) {
      timeoutResult = { status: error.status, retryable: error.retryable, message: error.message };
    }
    console.log(JSON.stringify({ unauthorizedCalls, unauthorizedStatus, rateCalls, serverCalls, serverStatus, timeoutCalls, timeoutResult }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.deepEqual(result, {
    unauthorizedCalls: 1,
    unauthorizedStatus: 401,
    rateCalls: 2,
    serverCalls: 3,
    serverStatus: 500,
    timeoutCalls: 3,
    timeoutResult: {
      status: 503,
      retryable: true,
      message: "Evotor request timed out."
    }
  });
});

test("Evotor client distinguishes revoked tokens from missing REST permissions", () => {
  const fixture = testModule("src/lib/integrations/evotor/client.ts");
  let result;
  try {
    result = runTypeScript(`
    const { EvotorClient } = await import(${JSON.stringify(fixture.url)});
    const { z } = await import("zod");
    const client = new EvotorClient("safe-test-token", {
      fetchImpl: async (_url, options) => {
        const authorization = String(options?.headers?.Authorization ?? "");
        return Response.json([{ code: "forbidden", message: "Missing store read permission", token: authorization }], { status: 403 });
      }
    });
    try {
      await client.get("/stores", z.object({}));
    } catch (error) {
      console.log(JSON.stringify({
        status: error.status,
        endpoint: error.endpoint,
        providerCode: error.providerCode,
        message: error.message
      }));
    }
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.status, 403);
  assert.equal(result.endpoint, "GET /stores");
  assert.equal(result.providerCode, "forbidden");
  assert.match(result.message, /REST API permissions/);
  assert.doesNotMatch(JSON.stringify(result), /safe-test-token|Bearer/);
});

test("receipt parsing keeps fiscal analytics but strips customer and device identifiers", () => {
  const fixture = testModule("src/lib/integrations/evotor/receipts.ts", { removeTypeImport: true });
  let result;
  try {
    result = runTypeScript(`
    const { parseEvotorReceipt } = await import(${JSON.stringify(fixture.url)});
    const receipt = parseEvotorReceipt({
      id: "receipt-1", type: "SELL", number: 10, close_date: "2026-08-12T10:00:00Z",
      device_id: "device-1", store_id: "store-1", employee_id: "employee-1",
      body: {
        result_sum: 500,
        client_phone: "+79990000000",
        payments: [{ type: "CASH", sum: 500 }],
        positions: [{ id: "line-1", product_id: "product-1", name: "Бургер", quantity: 1, result_price: 500, result_sum: 500, imei: "hidden" }]
      }
    });
    console.log(JSON.stringify(receipt));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.externalId, "receipt-1");
  assert.equal(result.total, 500);
  assert.equal(result.items.length, 1);
  assert.doesNotMatch(JSON.stringify(result.raw), /79990000000|hidden/);
});

test("database constraints and upserts make token, store, product, and receipt imports idempotent", () => {
  assert.match(migration, /evotor_user_id text not null unique/);
  assert.match(migration, /token_fingerprint text not null unique/);
  assert.match(migration, /unique \(store_id, evotor_product_id\)/);
  assert.match(migration, /unique \(connection_id, external_receipt_id\)/);
  assert.match(migration, /unique \(receipt_id, source_key\)/);
  assert.match(repository, /on conflict \(idempotency_key\) do update/);
  assert.match(sync, /on conflict \(connection_id, evotor_document_id\) do update/);
  assert.match(sync, /on conflict \(connection_id, external_receipt_id\) do update/);
});

test("Evotor tables are private and imported receipts never mutate inventory", () => {
  assert.match(migration, /alter table public\.evotor_receipts enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.evotor_connections from public/);
  assert.match(migration, /grant select, insert, update, delete[\s\S]+to karimoff_app/);
  assert.doesNotMatch(sync, /inventory_items|inventory_movements|order_inventory_deductions/);
});

test("connection check reads stores and devices but skips sales data", () => {
  assert.match(sync, /const stores = await fetchEvotorStores\(client\)/);
  assert.match(sync, /const devices = await fetchEvotorDevices\(client\)/);
  assert.match(sync, /const isFullCatalogSync = \["initial", "installation", "manual"\]\.includes/);
  assert.match(sync, /const employees = isFullCatalogSync && !isConnectionCheck[\s\S]+fetchEvotorEmployees/);
  assert.match(sync, /if \(!isConnectionCheck\) \{[\s\S]+fetchEvotorDocuments/);
  assert.match(sync, /classifyEvotorFailure\(failureContext\(error\)\)/);
  assert.match(sync, /status = \$\{classification\.connectionStatus\}/);
});

test("admin actions require staff permissions and never expose a token", () => {
  assert.match(adminAction, /getCurrentStaff/);
  assert.match(adminAction, /\["owner", "admin", "manager"\]\.includes\(staff\.role\)/);
  assert.match(adminAction, /consumeEvotorRateLimitKey/);
  assert.doesNotMatch(adminAction, /encrypted_token|EVOTOR_TOKEN_ENCRYPTION_KEY/);
});
