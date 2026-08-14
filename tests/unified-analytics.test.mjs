import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260812213000_add_unified_sales_analytics.sql");
const dashboard = read("src/lib/analytics/dashboard.ts");
const sales = read("src/lib/analytics/sales.ts");
const query = read("src/lib/analytics/query.ts");
const permissions = read("src/lib/analytics/permissions.ts");
const exportRoute = read("src/app/api/admin/analytics/sales/export/route.ts");
const filterBar = read("src/components/admin/analytics/AnalyticsFilterBar.tsx");
const trendChart = read("src/components/admin/analytics/AnalyticsTrendChart.tsx");
const saleDrawer = read("src/components/admin/analytics/AnalyticsSaleDrawer.tsx");
const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
const dockerfile = read("Dockerfile");

function analyticsFixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-analytics-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const name of ["types", "periods", "metrics", "filters", "channels"]) {
    const source = read(`src/lib/analytics/${name}.ts`).replace(
      /from "\.\/(types|periods|metrics|filters|channels)"/g,
      'from "./$1.ts"'
    );
    writeFileSync(join(directory, `${name}.ts`), source);
  }
  return {
    url: (name) => pathToFileURL(join(directory, `${name}.ts`)).href,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

function runTypeScript(source) {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    source
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("analytics periods honor Moscow day boundaries, custom ranges, and DST zones", () => {
  const fixture = analyticsFixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(fixture.url("periods"))});
      const moscow = module.getAnalyticsRange({ period: "today", now: new Date("2026-08-12T21:30:00Z") });
      const custom = module.getAnalyticsRange({ period: "custom", dateFrom: "2026-08-01", dateTo: "2026-08-03" });
      const dst = module.getAnalyticsRange({ period: "custom", dateFrom: "2026-03-08", dateTo: "2026-03-08", timezone: "America/New_York" });
      console.log(JSON.stringify({
        moscow: [moscow.from.toISOString(), moscow.to.toISOString(), moscow.fromDateKey],
        custom: [custom.fromDateKey, custom.toDateKeyExclusive],
        dstHours: (dst.to - dst.from) / 3600000
      }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.deepEqual(result.moscow, ["2026-08-12T21:00:00.000Z", "2026-08-13T21:00:00.000Z", "2026-08-13"]);
  assert.deepEqual(result.custom, ["2026-08-01", "2026-08-04"]);
  assert.equal(result.dstHours, 23);
});

test("comparison ranges keep exact previous duration and calendar shifts", () => {
  const fixture = analyticsFixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(fixture.url("periods"))});
      const range = module.getAnalyticsRange({ period: "30d", now: new Date("2026-08-12T10:00:00Z") });
      const previous = module.getComparisonRange(range, "previous_period");
      const month = module.getComparisonRange(range, "previous_month");
      const year = module.getComparisonRange(range, "previous_year");
      console.log(JSON.stringify({
        range: [range.fromDateKey, range.toDateKeyExclusive],
        previous: [previous.fromDateKey, previous.toDateKeyExclusive],
        month: [month.fromDateKey, month.toDateKeyExclusive],
        year: [year.fromDateKey, year.toDateKeyExclusive]
      }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.deepEqual(result.range, ["2026-07-14", "2026-08-13"]);
  assert.deepEqual(result.previous, ["2026-06-14", "2026-07-14"]);
  assert.deepEqual(result.month, ["2026-06-14", "2026-07-13"]);
  assert.deepEqual(result.year, ["2025-07-14", "2025-08-13"]);
});

test("metric comparisons avoid meaningless percentages and normalize payments", () => {
  const fixture = analyticsFixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(fixture.url("metrics"))});
      console.log(JSON.stringify({
        newValue: module.calculateMetricDelta(100, 0),
        empty: module.calculateMetricDelta(0, 0),
        decline: module.calculateMetricDelta(75, 100),
        payments: ["CASH", "electron", "SBP", "mystery"].map(module.normalizePaymentMethod),
        refundedLabel: module.getSaleStatusLabel("refunded"),
        emptyAverage: module.safeAverage(100, 0)
      }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.newValue.percent, null);
  assert.equal(result.newValue.direction, "new");
  assert.equal(result.empty.direction, "flat");
  assert.equal(result.decline.percent, -25);
  assert.deepEqual(result.payments, ["cash", "bank_card", "sbp", "unknown"]);
  assert.equal(result.refundedLabel, "Возврат");
  assert.equal(result.emptyAverage, 0);
});

test("URL filters are validated, shareable, and preserve channel and custom period", () => {
  const fixture = analyticsFixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(fixture.url("filters"))});
      const filters = module.parseAnalyticsFilters(new URLSearchParams("period=custom&from=2026-08-01&to=2026-08-12&channel=pos_evotor&page=4&pageSize=1000&sort=net&direction=asc"));
      const invalid = module.parseAnalyticsFilters(new URLSearchParams("period=forever&channel=fake&page=-2"));
      console.log(JSON.stringify({ filters, serialized: module.analyticsFiltersToParams(filters).toString(), invalid }));
    `);
  } finally {
    fixture.cleanup();
  }
  assert.equal(result.filters.period, "custom");
  assert.equal(result.filters.channel, "pos_evotor");
  assert.equal(result.filters.pageSize, 100);
  assert.match(result.serialized, /period=custom/);
  assert.match(result.serialized, /channel=pos_evotor/);
  assert.equal(result.invalid.period, "30d");
  assert.equal(result.invalid.channel, "all");
  assert.equal(result.invalid.page, 1);
});

test("database views normalize POS and web without inventing mobile or aggregator rows", () => {
  assert.match(migration, /create or replace view public\.analytics_sales/);
  assert.match(migration, /create or replace view public\.analytics_sale_items/);
  assert.match(migration, /create or replace view public\.analytics_sale_payments/);
  assert.match(migration, /'pos_evotor'::text as source/);
  assert.match(migration, /'web'::text as source/);
  assert.doesNotMatch(migration, /'mobile'::text as source|'aggregator'::text as source/);
  assert.match(filterBar, /options\.channels\.map/);
  assert.match(filterBar, /options\.hasPreviousYear/);
  assert.match(dashboard, /min\(s\.analytics_at\) <= now\(\) - interval '1 year'/);
});

test("revenue, discounts, refunds, and average ticket are calculated in PostgreSQL", () => {
  assert.match(dashboard, /sum\(s\.net_revenue\)/);
  assert.match(dashboard, /sum\(s\.gross_amount - s\.discount_amount\)/);
  assert.match(dashboard, /sum\(s\.refund_amount\)/);
  assert.match(dashboard, /count\(\*\) filter \(where s\.sale_count_eligible\)/);
  assert.match(dashboard, /filter \(where s\.sale_count_eligible and p\.amount > 0\)/);
  assert.match(migration, /when r\.receipt_type = 'return' then -r\.total/);
  assert.match(migration, /o\.status = 'completed'/);
  assert.match(migration, /o\.payment_status in \('paid', 'not_required', 'partially_refunded', 'refunded'\)/);
});

test("product mapping is stable, confirmed-only, and unmapped POS lines remain visible", () => {
  assert.match(migration, /mapping\.status = 'confirmed'/);
  assert.match(migration, /coalesce\(mapping\.status, 'unmapped'\)/);
  assert.match(dashboard, /mappingStatus: row\.mapping_status === "mapped"/);
  assert.doesNotMatch(migration, /lower\(ep\.name\)\s*=\s*lower\(/);
});

test("reconciliation only accepts reliable references and never guesses by amount or time", () => {
  assert.match(migration, /match_method in \('external_reference', 'fiscal_reference', 'manual'\)/);
  assert.match(migration, /where status = 'confirmed'/);
  const reconciliationSection = migration.slice(0, migration.indexOf("create table if not exists public.staff_location_access"));
  assert.doesNotMatch(reconciliationSection, /amount|analytics_at|closed_at|product_name/);
});

test("journal pagination, sorting, filtering, and CSV export stay server-side", () => {
  assert.match(sales, /limit \$\{limitPlaceholder\} offset \$\{offsetPlaceholder\}/);
  assert.match(sales, /const expressions: Record<AnalyticsFilters\["sort"\], string>/);
  assert.match(query, /analytics_at >=/);
  assert.match(query, /source =/);
  assert.match(query, /location_id = any/);
  assert.match(query, /exists \([\s\S]+analytics_sale_items/);
  assert.match(exportRoute, /getAnalyticsSalesExportBatch/);
  assert.match(exportRoute, /limit: 500/);
  assert.match(exportRoute, /ReadableStream/);
  assert.match(exportRoute, /\^\[=\+\\-@\]/);
  assert.match(sales, /const currentPage = Math\.min\(filters\.page, pageCount\)/);
});

test("analytics UI handles negative revenue and remains keyboard accessible", () => {
  assert.match(trendChart, /const minimum = Math\.min\(0, \.\.\.allValues\)/);
  assert.match(trendChart, /const baselineY = chartY\(0, minimum, maximum\)/);
  assert.match(filterBar, /aria-pressed=/);
  assert.match(filterBar, /analytics-filter-sheet-heading/);
  assert.match(saleDrawer, /event\.key === "Escape"/);
  assert.match(saleDrawer, /event\.key !== "Tab"/);
  assert.match(saleDrawer, /getSaleStatusLabel/);
});

test("analytics permissions deny cooks and fail closed for unscoped managers", () => {
  assert.match(permissions, /!\["owner", "admin", "manager"\]\.includes\(staff\.role\)/);
  assert.match(permissions, /locationIds: \[\]/);
  assert.match(query, /if \(!scope\.locationIds\.length\) clauses\.push\("false"\)/);
  assert.match(exportRoute, /getAnalyticsScope/);
  assert.match(migration, /analytics_sale_reconciliations_app_access/);
  assert.match(migration, /staff_location_access_app_access/);
  assert.match(migration, /for select to karimoff_app using \(true\)/);
});

test("indexes support time, terminal, employee, product, and reconciliation queries", () => {
  for (const index of [
    "evotor_receipts_device_closed_idx",
    "evotor_receipts_employee_closed_idx",
    "evotor_receipt_items_product_idx",
    "orders_completed_analytics_idx",
    "order_items_product_order_idx",
    "analytics_reconciliations_confirmed_idx"
  ]) assert.match(migration, new RegExp(index));
});

test("the standalone container applies the analytics migration idempotently", () => {
  assert.match(runtimeMigrations, /20260812213000_add_unified_sales_analytics/);
  assert.match(runtimeMigrations, /to_regclass\('public\.analytics_sales'\)/);
  assert.match(runtimeMigrations, /to_regclass\('public\.analytics_sale_items'\)/);
  assert.match(runtimeMigrations, /to_regclass\('public\.analytics_sale_payments'\)/);
  assert.match(dockerfile, /20260812213000_add_unified_sales_analytics\.sql/);
});
