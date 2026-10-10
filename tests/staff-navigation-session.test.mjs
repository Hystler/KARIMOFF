import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { canCreatePosOrder, canAccessKitchen } = loadTypeScript("src/lib/order-flow/permissions.ts");

function authentication(role, sessionOverrides = {}) {
  const calls = [];
  const session = { subject_type: "staff", subject_id: "fixture-staff", revoked_at: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(), ...sessionOverrides };
  const auth = loadTypeScript("src/lib/admin-auth.ts", {
    "server-only": {},
    "node:crypto": crypto,
    "next/headers": { cookies: async () => ({ get: () => ({ value: "fixture-token" }) }) },
    "@/lib/phone": { normalizeRussianPhone: (value) => value },
    "@/lib/password-auth": {},
    "@/lib/totp": {},
    "@/lib/database/server": { createDatabaseServerClient: () => ({ from(table) {
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, "eq", value]); return builder; },
        in(key, value) { filters.push([key, "in", value]); return builder; },
        is(key, value) { filters.push([key, "is", value]); return builder; },
        gt(key, value) { filters.push([key, "gt", value]); return builder; },
        async maybeSingle() {
          calls.push({ table, filters });
          if (table === "app_sessions") {
            const valid = session.revoked_at === null && new Date(session.expires_at) > new Date();
            return { data: valid ? session : null, error: null };
          }
          return { data: { id: "fixture-staff", name: "Fixture", phone: "+70000000000", role, is_active: true }, error: null };
        }
      };
      return builder;
    } }) }
  });
  return { auth, calls };
}

for (const role of ["owner", "admin"]) {
  test(`${role} keeps the same authenticated identity across ERP, POS, and kitchen reads`, async () => {
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "staff-navigation-local-fixture-secret";
    try {
      const { auth, calls } = authentication(role);
      for (let index = 0; index < 3; index++) {
        const staff = await auth.getCurrentStaff();
        assert.equal(staff.role, role);
        assert.equal(staff.id, "fixture-staff");
        assert.equal(canCreatePosOrder(staff.role), true);
        assert.equal(canAccessKitchen(staff.role), true);
      }
      assert.equal(calls.filter((call) => call.table === "app_sessions").length, 3);
      for (const call of calls.filter((call) => call.table === "app_sessions")) {
        assert.ok(call.filters.some(([key, operator, value]) => key === "revoked_at" && operator === "is" && value === null));
        assert.ok(call.filters.some(([key, operator]) => key === "expires_at" && operator === "gt"));
        assert.ok(call.filters.some(([key, operator, values]) => key === "subject_type" && operator === "in" && values.join() === "admin,staff"));
      }
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });
}

test("expired and revoked staff sessions remain unauthenticated during navigation", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "staff-navigation-local-fixture-secret";
  try {
    for (const overrides of [{ revoked_at: new Date().toISOString() }, { expires_at: "2020-01-01T00:00:00Z" }]) {
      const { auth } = authentication("owner", overrides);
      assert.equal(await auth.getCurrentStaff(), null);
    }
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
