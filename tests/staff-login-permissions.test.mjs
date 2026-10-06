import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const uuidCook = "11111111-1111-4111-8111-111111111111";
const uuidCashier = "22222222-2222-4222-8222-222222222222";
const uuidManager = "33333333-3333-4333-8333-333333333333";
const locations = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key: "north", name: "Север", isDefault: true },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key: "south", name: "Юг", isDefault: false }
];

function createLoader({ mocks = {}, env = {}, consoleMock = console } = {}) {
  const cache = new Map();

  function load(relativePath) {
    const file = resolve(root, relativePath);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const source = readFileSync(file, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText;

    function importModule(specifier) {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier === "@/lib/phone") return load("src/lib/phone.ts");
      if (specifier === "@/lib/request-security") return load("src/lib/request-security.ts");
      if (specifier.startsWith("node:")) return require(specifier);
      if (specifier.startsWith("./")) {
        const sibling = resolve(dirname(file), specifier);
        for (const extension of [".ts", ".tsx", ".js"]) {
          try {
            return load(`${sibling.slice(root.length + 1)}${extension}`);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
      }
      throw new Error(`Unexpected import in test harness: ${specifier}`);
    }

    runInNewContext(compiled, {
      exports: loadedModule.exports,
      module: loadedModule,
      require: importModule,
      process: { env },
      console: consoleMock,
      Buffer,
      URL,
      Headers,
      Request,
      Response,
      Date,
      setTimeout,
      clearTimeout
    }, { filename: file });
    return loadedModule.exports;
  }

  return { load };
}

function loginHarness({ staffRows = [], passwordAccepted = true } = {}) {
  const calls = { sessions: [], audits: [], failures: [], lookups: [] };
  const db = {
    from(table) {
      assert.equal(table, "staff_users");
      return {
        select() {
          return {
            in: async (_column, phones) => {
              calls.lookups.push(phones);
              return { data: staffRows.filter((staff) => phones.includes(staff.phone)), error: null };
            }
          };
        },
        update() {
          return { eq: async () => ({ error: null }) };
        }
      };
    }
  };
  const mocks = {
    "next/navigation": {
      redirect(path) {
        const error = new Error("NEXT_REDIRECT");
        error.path = path;
        throw error;
      }
    },
    "@/lib/auth-rate-limit": {
      clearAuthFailures: async () => {},
      checkAuthRateLimit: async () => ({ allowed: true }),
      recordAuthFailure: async (...args) => calls.failures.push(args)
    },
    "@/lib/audit": { writeAuditLog: async (entry) => calls.audits.push(entry) },
    "@/lib/admin-auth": {
      clearAdminSession: async () => {},
      getAdminActorHash: () => "admin-hash",
      setAdminSession: async () => {},
      setStaffSession: async (staffId) => calls.sessions.push({ subject_type: "staff", subject_id: staffId }),
      verifyAdminCredentials: async () => false
    },
    "@/lib/legal-consents": { hashPrivacyValue: (value) => `hash:${value}` },
    "@/lib/password-auth": {
      hashPassword: async () => "new-hash",
      passwordNeedsRehash: () => false,
      verifyPassword: async (password, hash) => passwordAccepted && password === "secret-password" && hash === "stored-hash"
    },
    "@/lib/database/server": { createDatabaseServerClient: () => db },
    "@/lib/security/csrf": { assertTrustedRequestOrigin: async () => {} },
    "@/lib/security/staff-login-csrf": { verifyStaffLoginCsrfToken: (token) => token === "valid-token" },
    "server-only": {}
  };
  const loader = createLoader({ mocks, env: { NODE_ENV: "test", SESSION_SECRET: "test-only-secret" } });
  return { ...calls, load: loader.load };
}

function staffManagementHarness({ existingPhones = [], activeLocationIds = locations.map((location) => location.id) } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
    calls.push({ query, values });
    if (query.includes("select id from public.staff_users")) {
      return existingPhones.some((phone) => values[0].includes(phone)) ? [{ id: uuidCashier }] : [];
    }
    if (query.includes("insert into public.staff_users")) return [{ id: uuidCook }];
    if (query.includes("from public.order_locations")) {
      return activeLocationIds.filter((id) => values[0].includes(id)).map((id) => ({
        id,
        location_key: `order:location:${id}`
      }));
    }
    if (query.includes("update public.staff_users")) return [{ id: values[1] }];
    return [];
  };
  sql.begin = async (callback) => callback(sql);
  const loader = createLoader({ mocks: {
    "server-only": {},
    "@/lib/postgres/server": { getPostgresSql: () => sql }
  } });
  return { calls, load: loader.load };
}

async function runLogin(harness, { phone, password = "secret-password" }) {
  const action = harness.load("src/app/admin/login/actions.ts").loginAction;
  const form = new FormData();
  form.set("csrf_token", "valid-token");
  form.set("phone", phone);
  form.set("password", password);
  try {
    await action(form);
    assert.fail("Login action did not redirect");
  } catch (error) {
    if (error?.message !== "NEXT_REDIRECT") throw error;
    return error.path;
  }
}

test("staff login normalizes +7, 8, 7 and formatted numbers to the same account", async () => {
  for (const phone of [
    "+79991234567",
    "89991234567",
    "79991234567",
    "+7 (999) 123-45-67",
    "8 (999) 123-45-67"
  ]) {
    const harness = loginHarness({ staffRows: [{
      id: uuidCook,
      name: "Тестовый повар",
      phone: "+79991234567",
      role: "cook",
      password_hash: "stored-hash",
      is_active: true
    }] });
    assert.equal(await runLogin(harness, { phone }), "/kitchen");
    assert.deepEqual(harness.sessions, [{ subject_type: "staff", subject_id: uuidCook }]);
  }
});

test("login resolves a single legacy formatted phone row and rejects ambiguous legacy duplicates", async () => {
  const legacy = loginHarness({ staffRows: [{
    id: uuidCook,
    name: "Тестовый повар",
    phone: "89991234567",
    role: "cook",
    password_hash: "stored-hash",
    is_active: true
  }] });
  assert.equal(await runLogin(legacy, { phone: "+7 (999) 123-45-67" }), "/kitchen");

  const ambiguous = loginHarness({ staffRows: [
    { id: uuidCook, phone: "89991234567", role: "cook", password_hash: "stored-hash", is_active: true },
    { id: uuidCashier, phone: "79991234567", role: "cashier", password_hash: "stored-hash", is_active: true }
  ] });
  assert.equal(await runLogin(ambiguous, { phone: "+79991234567" }), "/admin/login?error=invalid");
  assert.equal(ambiguous.sessions.length, 0);
});

test("staff roles redirect to their intended workspace and create one staff session", async () => {
  for (const [role, expectedPath, id] of [
    ["cook", "/kitchen", uuidCook],
    ["cashier", "/pos", uuidCashier],
    ["manager", "/admin", uuidManager]
  ]) {
    const harness = loginHarness({ staffRows: [{
      id,
      name: "Сотрудник",
      phone: "+79991234567",
      role,
      password_hash: "stored-hash",
      is_active: true
    }] });
    assert.equal(await runLogin(harness, { phone: "+79991234567" }), expectedPath);
    assert.equal(harness.sessions.length, 1);
    assert.equal(harness.audits.some((entry) => entry.action === "staff.login"), true);
  }
});

test("incorrect password and unknown phone never create sessions", async () => {
  const incorrect = loginHarness({ staffRows: [{
    id: uuidCook,
    phone: "+79991234567",
    role: "cook",
    password_hash: "stored-hash",
    is_active: true
  }], passwordAccepted: false });
  assert.equal(await runLogin(incorrect, { phone: "+79991234567", password: "wrong" }), "/admin/login?error=invalid");
  assert.equal(incorrect.sessions.length, 0);

  const unknown = loginHarness();
  assert.equal(await runLogin(unknown, { phone: "89990000000" }), "/admin/login?error=invalid");
  assert.equal(unknown.sessions.length, 0);
});

test("staff session writer inserts a staff app_session and sets an HttpOnly strict cookie", async () => {
  const inserted = [];
  const cookies = new Map();
  const db = {
    from(table) {
      assert.equal(table, "app_sessions");
      return {
        update: () => ({
          eq: () => ({ in: async () => ({ error: null }) })
        }),
        insert: async (row) => { inserted.push(row); return { error: null }; }
      };
    }
  };
  const loader = createLoader({
    env: { NODE_ENV: "production", SESSION_SECRET: "test-only-secret" },
    mocks: {
      "server-only": {},
      "next/headers": {
        cookies: async () => ({
          get: (name) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
          set: (name, value, options) => cookies.set(name, { value, options })
        }),
        headers: async () => new Headers({ "user-agent": "test-agent" })
      },
      "@/lib/database/server": { createDatabaseServerClient: () => db },
      "@/lib/password-auth": { verifyPassword: async () => false },
      "@/lib/totp": { verifyTotpCode: () => true }
    }
  });
  await loader.load("src/lib/admin-auth.ts").setStaffSession(uuidCook);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].subject_type, "staff");
  assert.equal(inserted[0].subject_id, uuidCook);
  assert.match(inserted[0].token_hash, /^[a-f0-9]{64}$/);
  const sessionCookie = cookies.get("karimoff_admin_session");
  assert.ok(sessionCookie?.value);
  assert.equal(sessionCookie.options.httpOnly, true);
  assert.equal(sessionCookie.options.sameSite, "strict");
  assert.equal(sessionCookie.options.secure, true);
});

test("opaque-origin login repair is restricted to same-site login Server Actions behind the trusted proxy", () => {
  const loader = createLoader({
    env: { NODE_ENV: "production", APP_ORIGIN: "https://karimoff.site" },
    mocks: { "server-only": {} }
  });
  const { getOpaqueStaffLoginOriginHeaders } = loader.load("src/lib/security/opaque-staff-login-origin.ts");
  const request = (headers) => new Request("https://internal/admin/login", {
    method: "POST",
    headers: {
      host: "internal",
      "x-forwarded-host": "karimoff.site",
      "x-forwarded-proto": "https",
      "next-action": "action-id",
      origin: "null",
      ...headers
    }
  });
  const rewritten = getOpaqueStaffLoginOriginHeaders(request({ "sec-fetch-site": "same-origin" }));
  assert.equal(rewritten?.get("origin"), "https://karimoff.site");
  assert.equal(rewritten?.get("x-forwarded-host"), "karimoff.site");
  assert.equal(getOpaqueStaffLoginOriginHeaders(request({ "sec-fetch-site": "cross-site" })), null);
  assert.equal(getOpaqueStaffLoginOriginHeaders(request({ origin: "https://attacker.example" })), null);
  assert.equal(getOpaqueStaffLoginOriginHeaders(new Request("https://internal/admin/staff", {
    method: "POST",
    headers: { "next-action": "action-id", origin: "null" }
  })), null);
});

test("origin validation trusts the production reverse-proxy host, not a foreign origin", () => {
  const loader = createLoader({
    env: { NODE_ENV: "production" },
    mocks: { "server-only": {}, "next/headers": { headers: async () => new Headers() } }
  });
  const { isTrustedRequestOrigin } = loader.load("src/lib/security/csrf.ts");
  assert.equal(isTrustedRequestOrigin({
    origin: "https://karimoff.site",
    host: "internal:3000",
    forwardedHost: "karimoff.site",
    forwardedProto: "https"
  }), true);
  assert.equal(isTrustedRequestOrigin({
    origin: "https://attacker.example",
    host: "internal:3000",
    forwardedHost: "karimoff.site",
    forwardedProto: "https"
  }), false);
});

test("location access limits kitchen and POS staff while owner and admin retain every active location", async () => {
  const allowedByStaff = new Map([
    [uuidCook, [locations[0].id]],
    [uuidCashier, [locations[1].id]],
    [uuidManager, []]
  ]);
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("from public.staff_location_access")) return (allowedByStaff.get(values[0]) ?? []).map((order_location_id) => ({ order_location_id }));
    throw new Error(`Unexpected location query: ${query}`);
  };
  const loader = createLoader({
    mocks: {
      "server-only": {},
      "@/lib/postgres/server": { getPostgresSql: () => sql },
      "./queries": { getOrderLocations: async () => locations },
      "./types": {}
    }
  });
  const access = loader.load("src/lib/order-flow/access.ts");
  const cookLocations = await access.getAccessibleOrderLocations({ id: uuidCook, role: "cook", legacy: false });
  assert.deepEqual(cookLocations.map((location) => location.id), [locations[0].id]);
  assert.equal(await access.canStaffAccessOrderLocation({ id: uuidCook, role: "cook", legacy: false }, locations[0].id), true);
  assert.equal(await access.canStaffAccessOrderLocation({ id: uuidCook, role: "cook", legacy: false }, locations[1].id), false);
  assert.deepEqual((await access.getAccessibleOrderLocations({ id: uuidCashier, role: "cashier", legacy: false })).map((location) => location.id), [locations[1].id]);
  assert.deepEqual(await access.getAccessibleOrderLocations({ id: uuidManager, role: "manager", legacy: false }), []);
  for (const role of ["owner", "admin"]) {
    assert.deepEqual((await access.getAccessibleOrderLocations({ id: null, role, legacy: false })).map((location) => location.id), locations.map((location) => location.id));
  }
});

test("staff location assignment rules require a valid point only for operational staff roles", () => {
  const loader = createLoader({ mocks: { "server-only": {}, "@/lib/postgres/server": {} } });
  const { parseStaffLocationIds, staffRoleRequiresLocation } = loader.load("src/lib/staff-location-management.ts");
  assert.deepEqual(Array.from(parseStaffLocationIds([locations[0].id, locations[0].id])), [locations[0].id]);
  assert.equal(staffRoleRequiresLocation("cook"), true);
  assert.equal(staffRoleRequiresLocation("cashier"), true);
  assert.equal(staffRoleRequiresLocation("manager"), true);
  assert.equal(staffRoleRequiresLocation("admin"), false);
  assert.equal(staffRoleRequiresLocation("owner"), false);
  assert.throws(() => parseStaffLocationIds(["not-a-uuid"]), /invalid_location/);
});

test("staff creation assigns selected active locations and detects legacy phone duplicates", async () => {
  const assigned = staffManagementHarness();
  const { createStaffAccount } = assigned.load("src/lib/staff-location-management.ts");
  const staffId = await createStaffAccount({
    name: "Повар",
    phone: "+79991234567",
    passwordHash: "test-hash",
    role: "cook",
    locationIds: [locations[0].id, locations[1].id]
  });
  assert.equal(staffId, uuidCook);
  const lockIndex = assigned.calls.findIndex(({ query }) => query.includes("pg_advisory_xact_lock"));
  const duplicateCheckIndex = assigned.calls.findIndex(({ query }) => query.includes("select id from public.staff_users"));
  assert.ok(lockIndex >= 0 && lockIndex < duplicateCheckIndex);
  assert.equal(assigned.calls.filter(({ query }) => query.includes("insert into public.staff_location_access")).length, 2);
  assert.equal(assigned.calls.some(({ query }) => query.includes("delete from public.staff_location_access")), true);

  const duplicate = staffManagementHarness({ existingPhones: ["89991234567"] });
  const duplicateManagement = duplicate.load("src/lib/staff-location-management.ts");
  await assert.rejects(() => duplicateManagement.createStaffAccount({
    name: "Повар 2",
    phone: "+79991234567",
    passwordHash: "test-hash",
    role: "cook",
    locationIds: [locations[0].id]
  }), { name: "DuplicateStaffPhoneError" });
  assert.equal(duplicate.calls.some(({ query }) => query.includes("insert into public.staff_users")), false);
});

test("signed staff login CSRF token expires and cannot be forged", () => {
  const loader = createLoader({ env: { SESSION_SECRET: "test-only-secret" }, mocks: { "server-only": {} } });
  const csrf = loader.load("src/lib/security/staff-login-csrf.ts");
  const now = 1_800_000_000_000;
  const token = csrf.createStaffLoginCsrfToken(now);
  assert.equal(csrf.verifyStaffLoginCsrfToken(token, now), true);
  assert.equal(csrf.verifyStaffLoginCsrfToken(token, now + 15 * 60 * 1000), false);
  assert.equal(csrf.verifyStaffLoginCsrfToken(`${token}x`, now), false);
});

test("final role migration allows every application staff role; no new migration is needed", () => {
  const migration = readFileSync(resolve(root, "database/migrations/20260814120000_add_canonical_order_flow_kds.sql"), "utf8");
  assert.match(migration, /check \(role in \('owner', 'admin', 'manager', 'cashier', 'cook'\)\) not valid/);
});
