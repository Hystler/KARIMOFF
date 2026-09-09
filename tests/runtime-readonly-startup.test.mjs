import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("read-only startup skips data migrations before connecting to a database", () => {
  const output = execFileSync(process.execPath, ["scripts/apply-runtime-data-migrations.mjs"], {
    env: { PATH: process.env.PATH, RUNTIME_MIGRATIONS_READ_ONLY: "true", DATABASE_URL: "postgres://unreachable.invalid/test" },
    encoding: "utf8",
    timeout: 5000
  });
  assert.match(output, /skipped: read-only startup/);
});

test("read-only schema startup refuses missing migrations without any write", async () => {
  let options;
  let writes = 0;
  let closed = false;
  const errors = [];
  const sql = async () => [];
  sql.begin = async () => { writes += 1; throw new Error("unexpected write"); };
  sql.end = async () => { closed = true; };
  const processMock = { env: { DATABASE_URL: "fixture-only", RUNTIME_MIGRATIONS_READ_ONLY: "true" }, exitCode: 0 };
  const source = readFileSync("scripts/apply-runtime-schema-migrations.mjs", "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", '"file:///fixture/schema.mjs"');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("postgres", "readFileSync", "process", "console", source)(
    (_url, config) => { options = config; return sql; },
    () => { throw new Error("must not read migration SQL"); },
    processMock,
    { log() {}, error: (message) => errors.push(message) }
  );
  assert.equal(options.connection.default_transaction_read_only, "on");
  assert.equal(writes, 0);
  assert.equal(closed, true);
  assert.equal(processMock.exitCode, 1);
  assert.match(errors.join("\n"), /required migration missing in read-only startup/);
});
