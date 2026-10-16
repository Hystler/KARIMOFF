import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const script = readFileSync("scripts/telegram-order-notifications-preflight.mjs", "utf8")
  .split("function safeToPrint")[0]
  .replace(/^import .*;\n/gm, "")
  .replace("export async function runPreflight", "async function runPreflight");

async function preflight(rows, extraEnv = {}) {
  const queries = [];
  let requests = 0;
  const sql = async (strings) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    return rows;
  };
  sql.end = async () => {};
  const context = {
    process: { env: {
      TELEGRAM_BOT_TOKEN: "synthetic-secret", DATABASE_URL: "synthetic-db",
      APP_ORIGIN: "https://example.test", ORDER_STATUS_NOTIFICATIONS_ENABLED: "false",
      TELEGRAM_EXPECTED_BOT_USERNAME: "test_bot", ...extraEnv
    } },
    postgres: (_url, options) => {
      assert.equal(options.connection.default_transaction_read_only, true);
      return sql;
    },
    URL, AbortSignal,
    fetch: async (url, init) => {
      requests++;
      assert.match(url, /\/getMe$/);
      assert.equal(init.method, "GET");
      return Response.json({ ok: true, result: { is_bot: true, username: "test_bot" } });
    }
  };
  runInNewContext(`${script}\nthis.run = runPreflight;`, context);
  const result = JSON.parse(JSON.stringify(await context.run()));
  assert.equal(requests, 1);
  assert.equal(result.messageSent, false);
  assert.match(queries[0], /where provider = 'telegram' group by provider, status/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-db/);
  return result;
}

const row = (provider, status, count = 1) => ({
  provider, status, count, due: count, older_than_24h: count, stale_locks: 0
});

test("Telegram-only preflight passes with two pending MAX records and no MAX token", async () => {
  const result = await preflight([row("max", "pending", 2), row("telegram", "superseded", 2)]);
  assert.equal(result.queueAndConfigPreflightPassed, true);
  assert.deepEqual(Object.keys(result.notificationQueues), ["telegram"]);
  assert.equal(result.notificationQueues.telegram.superseded, 2);
});

test("Telegram pending, retry, processing and stale locks still block preflight", async () => {
  for (const status of ["pending", "retry", "processing"]) {
    assert.equal((await preflight([row("telegram", status)])).queueAndConfigPreflightPassed, false);
  }
  assert.equal((await preflight([{ ...row("telegram", "sent"), stale_locks: 1 }]))
    .queueAndConfigPreflightPassed, false);
});

test("master ON and maintenance still block transport preflight with an empty queue", async () => {
  for (const env of [{ ORDER_STATUS_NOTIFICATIONS_ENABLED: "true" }, { MAINTENANCE_MODE: "true" }]) {
    assert.equal((await preflight([], env)).queueAndConfigPreflightPassed, false);
  }
});
