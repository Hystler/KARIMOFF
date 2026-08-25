import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const repository = read("src/lib/integrations/evotor/repository.ts");
const sync = read("src/lib/integrations/evotor/sync.ts");
const adminPage = read("src/app/admin/integrations/evotor/page.tsx");

function recoveryModule() {
  const cacheDirectory = join(process.cwd(), ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-evotor-recovery-test-"));
  const file = join(directory, "recovery.ts");
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(file, read("src/lib/integrations/evotor/recovery.ts"));
  return {
    url: pathToFileURL(file).href,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

function runRecovery(source) {
  const fixture = recoveryModule();
  try {
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const recovery = await import(${JSON.stringify(fixture.url)});\n${source}`
    ], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    fixture.cleanup();
  }
}

test("transient 500, 429, timeout, and unknown infrastructure errors remain retryable", () => {
  const result = runRecovery(`
    console.log(JSON.stringify([
      recovery.classifyEvotorFailure({ source: "api", status: 500, retryable: true }),
      recovery.classifyEvotorFailure({ source: "api", status: 429, retryable: true }),
      recovery.classifyEvotorFailure({ source: "api", status: 503, retryable: true }),
      recovery.classifyEvotorFailure({ source: "unknown" })
    ]));
  `);
  assert.deepEqual(result, Array.from({ length: 4 }, () => ({
    kind: "transient",
    connectionStatus: "error"
  })));
});

test("401 is permanent auth failure and configuration failures stay blocked", () => {
  const result = runRecovery(`
    console.log(JSON.stringify({
      unauthorized: recovery.classifyEvotorFailure({ source: "api", status: 401, retryable: false }),
      forbidden: recovery.classifyEvotorFailure({ source: "api", status: 403, retryable: false }),
      configuration: recovery.classifyEvotorFailure({ source: "configuration" })
    }));
  `);
  assert.deepEqual(result, {
    unauthorized: { kind: "auth", connectionStatus: "revoked" },
    forbidden: { kind: "configuration", connectionStatus: "uninstalled" },
    configuration: { kind: "configuration", connectionStatus: "uninstalled" }
  });
});

test("retry delay grows exponentially with jitter and a fifteen-minute ceiling", () => {
  const result = runRecovery(`
    console.log(JSON.stringify({
      midpoint: [1, 2, 3, 4, 5, 6, 7].map((failure) => recovery.evotorRetryDelaySeconds(failure, 0.5)),
      firstBounds: [recovery.evotorRetryDelaySeconds(1, 0), recovery.evotorRetryDelaySeconds(1, 1)],
      ceilingBounds: [recovery.evotorRetryDelaySeconds(20, 0), recovery.evotorRetryDelaySeconds(20, 1)]
    }));
  `);
  assert.deepEqual(result.midpoint, [30, 60, 120, 240, 480, 900, 900]);
  assert.deepEqual(result.firstBounds, [24, 36]);
  assert.deepEqual(result.ceilingBounds, [720, 900]);
});

test("scheduler retries degraded connections but ignores auth and disabled states", () => {
  assert.match(repository, /connection\.status in \('connected', 'error'\)/);
  assert.doesNotMatch(repository, /connection\.status in \([^)]*'revoked'/);
  assert.doesNotMatch(repository, /connection\.status in \([^)]*'uninstalled'/);
  assert.match(repository, /recoverStaleEvotorSyncEvents\(now\)/);
  assert.match(repository, /status = 'running'[\s\S]+started_at <[\s\S]+status = 'pending'/);
  assert.match(sync, /c\.status in \('connected', 'error'\)[\s\S]+e\.requested_by not in/);
});

test("transient failure keeps one event pending and success restores the connection", () => {
  assert.match(sync, /status = \$\{retryable \? "pending" : "failed"\}/);
  assert.match(sync, /available_at = case[\s\S]+nextRetryAt/);
  assert.match(sync, /set status = 'connected', last_sync_at = now\(\), last_success_at = now\(\)/);
  assert.match(sync, /failed_items = 0, retry_count = 0/);
  assert.match(sync, /last_error_at = null, last_error_message = null/);
});

test("failed attempts do not rewind cursors and receipt deduplication remains intact", () => {
  const failureBlock = sync.slice(sync.indexOf("} catch (error)"));
  assert.doesNotMatch(failureBlock, /evotor_sync_cursors[\s\S]+update/);
  assert.match(sync, /on conflict \(connection_id, evotor_document_id\) do update/);
  assert.match(sync, /on conflict \(connection_id, external_receipt_id\) do update/);
  assert.match(repository, /syncType: params\.syncType/);
  assert.match(repository, /params\.syncType === "reconciliation"/);
});

test("admin UI distinguishes connected, retrying, auth error, and disabled states", () => {
  assert.match(adminPage, /Временная ошибка, повторим автоматически/);
  assert.match(adminPage, /Требуется переподключение/);
  assert.match(adminPage, /Отключён/);
  assert.match(adminPage, /Ошибок подряд/);
  assert.match(adminPage, /Следующая попытка/);
  assert.match(adminPage, /Последняя ошибка/);
});
