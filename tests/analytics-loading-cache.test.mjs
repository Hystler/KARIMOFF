import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

test("analytics cache preserves Date values and isolates live staff scopes, filters and invalidation", async () => {
  let reads = 0;
  const caches = [];
  const imports = {
    "server-only": {},
    zod: { z },
    "@/lib/postgres/server": { getPostgresSql: () => ({ unsafe: async (text) => {
      assert.match(text, /^\s*(select|with)\b/i);
      reads++;
      return [];
    } }) },
    "next/cache": { unstable_cache(fn, keys, options) {
      const entries = new Map();
      caches.push({ entries, tags: options.tags });
      return async (...args) => {
        const key = JSON.stringify(args);
        if (!entries.has(key)) entries.set(key, JSON.parse(JSON.stringify(await fn(...args))));
        return entries.get(key);
      };
    } }
  };
  const { parseAnalyticsFilters } = loadTypeScript("src/lib/analytics/filters.ts", imports);
  const { getAnalyticsRange } = loadTypeScript("src/lib/analytics/periods.ts", imports);
  const { getAnalyticsDashboard } = loadTypeScript("src/lib/analytics/dashboard.ts", imports);
  const params = { filters: parseAnalyticsFilters({ period: "30d" }), range: getAnalyticsRange({ period: "30d" }),
    scope: { role: "owner", locationIds: null, cacheKey: "owner:all" } };
  const first = await getAnalyticsDashboard(params);
  assert.ok(reads > 0);
  reads = 0;
  const cached = await getAnalyticsDashboard(params);
  assert.equal(reads, 0);
  assert.ok(cached.range.from instanceof Date);
  assert.ok(cached.comparisonRange.from instanceof Date);
  assert.deepEqual(cached.kpis, first.kpis);
  await getAnalyticsDashboard({ ...params, scope: { role: "manager", locationIds: ["order:location:A"], cacheKey: "manager:A" } });
  assert.ok(reads > 0, "a manager must not reuse the owner's data");
  reads = 0;
  await getAnalyticsDashboard({ ...params, filters: { ...params.filters, fulfillment: "pickup" } });
  assert.ok(reads > 0, "fulfillment changes must not reuse another report");
  for (const cache of caches) if (cache.tags.includes("karimoff-analytics")) cache.entries.clear();
  reads = 0;
  await getAnalyticsDashboard(params);
  assert.ok(reads > 0, "the existing refresh tag must invalidate the new cache");
});

test("purchase planning accepts 30 days without changing the default or allowing arbitrary horizons", () => {
  const { parsePlanningOptions } = loadTypeScript("src/lib/analytics/planning.ts", {
    "server-only": {}, "@/lib/postgres/server": {}, "./permissions": {}
  });
  assert.equal(parsePlanningOptions({ days: "30" }).horizon, 30);
  for (const days of ["31", "-1", "30.5", "unknown"]) assert.equal(parsePlanningOptions({ days }).horizon, 7);
});
