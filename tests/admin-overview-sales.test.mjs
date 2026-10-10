import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

function overview(sql) {
  return loadTypeScript("src/lib/admin-overview.ts", {
    "server-only": {},
    "@/lib/postgres/server": { getPostgresSql: () => sql },
    "@/lib/analytics/filters": loadTypeScript("src/lib/analytics/filters.ts"),
    "@/lib/analytics/periods": loadTypeScript("src/lib/analytics/periods.ts"),
    "@/lib/analytics/query": loadTypeScript("src/lib/analytics/query.ts")
  });
}

test("owner daily revenue uses included canonical sales across channels and the Moscow day", async () => {
  let captured;
  const { getAdminDailySales } = overview({ unsafe: async (text, values) => {
    captured = { text, values };
    return [{ revenue: "1200", sales: 3 }];
  } });
  const result = await getAdminDailySales({ role: "owner", locationIds: null, cacheKey: "owner:all" }, new Date("2026-10-09T22:00:00Z"));
  assert.deepEqual(result, { revenue: 1200, sales: 3, error: false });
  assert.match(captured.text, /from public\.canonical_analytics_sales s/);
  assert.match(captured.text, /sum\(s\.net_revenue\)/);
  assert.match(captured.text, /s\.analytics_included = true/);
  assert.match(captured.text, /where s\.sale_count_eligible/);
  assert.doesNotMatch(captured.text, /s\.source\s*=|public\.orders/);
  assert.deepEqual(captured.values, ["2026-10-09T21:00:00.000Z", "2026-10-10T21:00:00.000Z"]);
});

test("manager daily revenue retains scoped analytics locations and denies an empty scope", async () => {
  const calls = [];
  const { getAdminDailySales } = overview({ unsafe: async (text, values) => {
    calls.push({ text, values });
    return [{ revenue: 0, sales: 0 }];
  } });
  await getAdminDailySales({ role: "manager", locationIds: ["order:location:fixture"], cacheKey: "manager:fixture" });
  assert.match(calls[0].text, /s\.location_id = any\(\$3::text\[\]\)/);
  assert.deepEqual(calls[0].values[2], ["order:location:fixture"]);
  await getAdminDailySales({ role: "manager", locationIds: [], cacheKey: "manager:none" });
  assert.match(calls[1].text, /and false/);
});

test("a sales database failure remains unavailable instead of becoming an apparent zero", async () => {
  const { getAdminDailySales } = overview({ unsafe: async () => { throw new Error("fixture connection failure"); } });
  assert.deepEqual(await getAdminDailySales({ role: "owner", locationIds: null, cacheKey: "owner:all" }), {
    revenue: null, sales: null, error: true
  });
});
