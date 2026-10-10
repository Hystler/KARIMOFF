import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

function adapter(rows = []) {
  const calls = [];
  const { PostgresCompatClient } = loadTypeScript("src/lib/postgres/server.ts", {
    "server-only": {}, postgres: () => ({ unsafe: async (statement, parameters) => { calls.push({ statement, parameters }); return rows; } })
  });
  return { client: new PostgresCompatClient(), calls };
}

async function withAdapterEnvironment(run) {
  const previous = { DATABASE_URL: process.env.DATABASE_URL, STAGING_DATA_MODE: process.env.STAGING_DATA_MODE };
  // The mocked driver never connects; no actual credentials or production env are read.
  process.env.DATABASE_URL = "mock-driver-only";
  delete process.env.STAGING_DATA_MODE;
  try { await run(); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("the loyalty consent read accepts eq/neq OR without discarding valid consent or removing its scope", () => withAdapterEnvironment(async () => {
  const row = { consent_type: "loyalty_rules", granted: true, document_version: "current", source_path: "/profile/loyalty", subject_id: "customer-a" };
  const { client, calls } = adapter([row]);
  const { getCurrentConsentState } = loadTypeScript("src/lib/legal-consents.ts", {
    "server-only": {}, "node:crypto": {}, "next/headers": {}, "@/lib/legal": { LEGAL_VERSION: "current" },
    "@/lib/database/server": { createDatabaseServerClient: () => client }
  });
  assert.deepEqual(await getCurrentConsentState("customer-a", "loyalty_rules"), row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /"subject_type" = \$1 AND "subject_id" = \$2 AND "consent_type" = \$3 AND \("granted" = \$4 OR "source_path" <> \$5\)/);
  assert.match(calls[0].statement, /ORDER BY "created_at" DESC LIMIT 1/);
  assert.deepEqual(calls[0].parameters, ["customer", "customer-a", "loyalty_rules", true, "/checkout"]);
}));

test("OR values containing dots and SQL punctuation remain intact parameter values", () => withAdapterEnvironment(async () => {
  const { client, calls } = adapter();
  const value = "/profile/a.b' OR 1=1 --";
  const result = await client.from("legal_consents").select("id").or(`source_path.neq.${value}`);
  assert.equal(result.error, null);
  assert.equal(calls[0].statement, 'SELECT "id" FROM public."legal_consents" WHERE ("source_path" <> $1)');
  assert.deepEqual(calls[0].parameters, [value]);
  assert.ok(!calls[0].statement.includes(value));
}));

test("unsupported OR operators and unsafe columns fail before executing SQL", () => withAdapterEnvironment(async () => {
  const { client, calls } = adapter();
  for (const expression of ["granted.gt.true", "granted) OR 1=1.eq.true", "granted.eq.true,"]) {
    const result = await client.from("legal_consents").select("id").or(expression);
    assert.match(result.error.message, /Unsupported OR filter/);
  }
  assert.equal(calls.length, 0);
}));
