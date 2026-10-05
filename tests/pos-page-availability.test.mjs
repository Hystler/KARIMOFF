import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import ts from "typescript";

function loadModule(path, imports, processMock) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", code)(id => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports, processMock);
  return exports;
}

function pageHarness({ enabled = false, failing } = {}) {
  const calls = [];
  const errors = [];
  const products = [{ id: "synthetic-product", name: "Synthetic meal" }];
  const locations = [{ id: "synthetic-location", isDefault: true }];
  const terminals = [{ id: "synthetic-terminal" }];
  const payment = { intentId: "synthetic-intent", orderId: "synthetic-order", status: "unknown", amount: 100, result: {} };
  const read = (name, value) => async () => {
    calls.push(name);
    if (failing?.includes(name)) {
      throw Object.assign(new Error("private input must never be logged"), { code: "42702" });
    }
    return value;
  };
  const workspace = () => {};
  const unavailable = () => {};
  const api = loadModule("src/app/pos/page.tsx", {
    "node:crypto": { randomUUID: () => "synthetic-page-key" },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
    "@/components/operations/PosWorkspace": { PosWorkspace: workspace },
    "@/components/operations/OperationsUnavailable": { OperationsUnavailable: unavailable },
    "@/lib/admin-auth": { getCurrentStaff: async () => ({ role: "owner", name: "Synthetic staff" }) },
    "@/lib/order-flow/permissions": { canCreatePosOrder: () => true },
    "@/lib/products": { getActiveProducts: read("products", products) },
    "@/lib/order-flow/access": { getAccessibleOrderLocations: read("locations", locations) },
    "@/lib/integrations/evotor/pos-payments": {
      evotorPosPaymentsEnabled: () => enabled,
      getActiveEvotorPosPayment: read("active_payment", payment)
    },
    "@/lib/integrations/evotor/terminal-bridge": { getTerminalBridgeDevices: read("terminals", terminals) },
    "@/lib/observability": { logOperationalError: (event, fields) => errors.push({ event, ...fields }) }
  }, { env: { TEST_ORDER_MODE: "false" } });
  return { run: api.default, calls, errors, workspace, unavailable, products, locations, terminals, payment };
}

test("POS feature OFF renders menu/location without unavailable terminal/payment queries", async () => {
  const h = pageHarness({ failing: ["active_payment", "terminals"] });
  const result = await h.run();
  assert.equal(result.type, h.workspace);
  assert.deepEqual(h.calls, ["products", "locations"]);
  assert.deepEqual(result.props.products, h.products);
  assert.deepEqual(result.props.locations, h.locations);
  assert.equal(result.props.paymentsEnabled, false);
  assert.equal(result.props.initialPayment, null);
  assert.deepEqual(result.props.initialTerminals, []);
  assert.deepEqual(h.errors, []);
});

for (const resource of ["products", "locations"]) {
  test(`POS ${resource} failure stays unavailable and logs only safe error metadata`, async () => {
    const h = pageHarness({ failing: [resource] });
    assert.equal((await h.run()).type, h.unavailable);
    assert.deepEqual(h.errors, [{ event: "pos.page_load_failed", resource, error_type: "Error", error_code: "42702" }]);
    assert.ok(!JSON.stringify(h.errors).includes("private input"));
    assert.ok(!h.calls.includes("active_payment"));
  });
}

test("POS feature ON preserves active payment recovery and terminal loading", async () => {
  const h = pageHarness({ enabled: true });
  const result = await h.run();
  assert.equal(result.type, h.workspace);
  assert.deepEqual(h.calls, ["products", "locations", "active_payment", "terminals"]);
  assert.equal(result.props.paymentsEnabled, true);
  assert.deepEqual(result.props.initialTerminals, h.terminals);
  assert.equal(result.props.initialPayment.intentId, h.payment.intentId);
});

for (const resource of ["active_payment", "terminals"]) {
  test(`POS enabled ${resource} failure is diagnosed, not mislabeled as menu failure`, async () => {
    const h = pageHarness({ enabled: true, failing: [resource] });
    const result = await h.run();
    assert.equal(result.type, h.unavailable);
    assert.match(result.props.message, /состояние кассы/);
    assert.equal(h.errors[0].resource, resource);
  });
}

test("opening POS uses only read dependencies and feature OFF stops terminal polling", async () => {
  for (const enabled of [false, true]) {
    const h = pageHarness({ enabled });
    await h.run();
    assert.ok(h.calls.every(name => ["products", "locations", "active_payment", "terminals"].includes(name)));
  }
  const workspace = readFileSync("src/components/operations/PosWorkspace.tsx", "utf8");
  assert.match(workspace, /useEffect\(\(\) => \{\s*if \(!paymentsEnabled\) return;\s*const refresh/);
  assert.match(workspace, /\}, \[paymentsEnabled\]\)/);
  assert.match(workspace, /disabled=\{[^\n]*!paymentsEnabled/);
});

test("PG17 terminal listing resolves joined timestamp columns under runtime SELECT access", async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? "", /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/);
  const sql = postgres(dsn, { max: 1, onnotice() {}, connection: { default_transaction_read_only: "on" } });
  try {
    const api = loadModule("src/lib/integrations/evotor/terminal-bridge.ts", {
      "server-only": {},
      "node:crypto": { createHmac, randomBytes, randomInt },
      "@/lib/postgres/server": { getPostgresSql: () => sql }
    }, { env: { EVOTOR_TERMINAL_BRIDGE_ENABLED: "true", EVOTOR_TERMINAL_BRIDGE_SECRET: "synthetic-test-key-not-a-real-secret" } });
    await assert.rejects(sql`select device.id from evotor_terminal_devices device
      left join evotor_devices cloud on cloud.id=device.cloud_device_id
      left join evotor_stores store on store.id=cloud.store_id
      order by paired_at desc nulls last, created_at desc limit 0`, error => error.code === "42702");
    assert.ok(Array.isArray(await api.getTerminalBridgeDevices(null)));
    assert.ok(Array.isArray(await api.getTerminalBridgeDevices(["00000000-0000-0000-0000-000000000000"])));
  } finally {
    await sql.end();
  }
});
