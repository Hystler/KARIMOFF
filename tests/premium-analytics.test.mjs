import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const intelligence = read("src/lib/analytics/intelligence.ts");
const dashboard = read("src/lib/analytics/dashboard.ts");
const query = read("src/lib/analytics/query.ts");
const filterBar = read("src/components/admin/analytics/AnalyticsFilterBar.tsx");
const hub = read("src/components/admin/analytics/AnalyticsIntelligenceHub.tsx");
const rangePicker = read("src/components/admin/RussianDateRangePicker.tsx");
const reportExport = read("src/app/api/admin/analytics/report/export/route.ts");
const operationalMigration = read("supabase/migrations/20260815103000_refine_pos_kds_display_operations.sql");

function fixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-premium-analytics-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const name of ["types", "periods", "metrics", "filters", "intelligence-math", "operating-hours", "palette"]) {
    const source = read(`src/lib/analytics/${name}.ts`).replace(
      /from "\.\/(types|periods|metrics|filters|intelligence-math|operating-hours)"/g,
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
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("premium filters combine categories, product, weekdays, and Moscow intraday range", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(files.url("filters"))});
      const filters = module.parseAnalyticsFilters(new URLSearchParams("period=last_quarter&category=Бургеры&category=Шаурма&product=p-1&weekday=1&weekday=6&hourFrom=17&hourTo=21"));
      const invalid = module.parseAnalyticsFilters(new URLSearchParams("hourFrom=21&hourTo=17&weekday=9"));
      console.log(JSON.stringify({ filters, serialized: module.analyticsFiltersToParams(filters).toString(), invalid }));
    `);
  } finally {
    files.cleanup();
  }
  assert.deepEqual(result.filters.categories, ["Бургеры", "Шаурма"]);
  assert.deepEqual(result.filters.weekdays, [1, 6]);
  assert.equal(result.filters.hourFrom, 17);
  assert.equal(result.filters.hourTo, 21);
  assert.match(result.serialized, /category=%D0%91%D1%83%D1%80%D0%B3%D0%B5%D1%80%D1%8B/);
  assert.match(result.serialized, /weekday=6/);
  assert.equal(result.invalid.hourFrom, null);
  assert.deepEqual(result.invalid.weekdays, []);
});

test("last quarter uses complete Moscow calendar-quarter boundaries", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(files.url("periods"))});
      const range = module.getAnalyticsRange({ period: "last_quarter", now: new Date("2026-08-17T10:00:00Z") });
      console.log(JSON.stringify([range.fromDateKey, range.toDateKeyExclusive, range.from.toISOString(), range.to.toISOString()]));
    `);
  } finally {
    files.cleanup();
  }
  assert.deepEqual(result.slice(0, 2), ["2026-04-01", "2026-07-01"]);
  assert.equal(result[2], "2026-03-31T21:00:00.000Z");
  assert.equal(result[3], "2026-06-30T21:00:00.000Z");
});

test("Pareto and ABC use cumulative revenue without reclassifying the catalog", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(files.url("intelligence-math"))});
      console.log(JSON.stringify(module.buildPareto([
        { key: "a", name: "A", revenue: 800, quantity: 8 },
        { key: "b", name: "B", revenue: 150, quantity: 3 },
        { key: "c", name: "C", revenue: 50, quantity: 2 }
      ])));
    `);
  } finally {
    files.cleanup();
  }
  assert.deepEqual(result.rows.map((row) => row.abc), ["A", "B", "C"]);
  assert.equal(result.productsTo50, 1);
  assert.equal(result.productsTo80, 1);
  assert.equal(result.productsTo90, 2);
});

test("average-ticket and revenue decomposition handle empty comparison bases", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(files.url("intelligence-math"))});
      const current = { revenue: 900, sales: 3, items: 6, saleRevenue: 1000, refunds: 100 };
      const previous = { revenue: 0, sales: 0, items: 0, saleRevenue: 0, refunds: 0 };
      console.log(JSON.stringify({ factors: module.buildAverageTicketFactors(current, previous), bridge: module.buildRevenueBridge(current, previous) }));
    `);
  } finally {
    files.cleanup();
  }
  assert.equal(result.factors.itemsPerReceipt.current, 2);
  assert.equal(result.factors.averageItemValue.current, 1000 / 6);
  assert.equal(result.factors.itemsPerReceipt.delta.percent, null);
  assert.equal(result.bridge.current, 900);
  assert.equal(result.bridge.refundChange, -100);
});

test("transparent anomaly requires history and a two-deviation signal", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const module = await import(${JSON.stringify(files.url("intelligence-math"))});
      console.log(JSON.stringify({ short: module.detectTransparentAnomaly(100, [10, 11, 9]), normal: module.detectTransparentAnomaly(11, [10, 11, 9, 10, 12]), spike: module.detectTransparentAnomaly(40, [10, 11, 9, 10, 12]) }));
    `);
  } finally {
    files.cleanup();
  }
  assert.equal(result.short, null);
  assert.equal(result.normal, null);
  assert.ok(result.spike.score >= 2);
});

test("premium analytics aggregates on the server and preserves stable product identity", () => {
  assert.match(intelligence, /public\.canonical_analytics_sales/);
  assert.match(intelligence, /public\.analytics_sale_items/);
  assert.match(intelligence, /coalesce\(i\.product_id::text, i\.source \|\| ':'/);
  assert.match(intelligence, /having count\(distinct left_item\.sale_id\) >= 2/);
  assert.match(intelligence, /status = 'success'/);
  assert.match(dashboard, /join public\.analytics_sale_items i on i\.sale_id = s\.sale_id/);
  assert.match(dashboard, /count\(distinct s\.sale_id\)/);
  assert.match(query, /at time zone 'Europe\/Moscow'/);
  assert.match(query, /analyticsCategorySql/);
  assert.match(query, /= any/);
  assert.doesNotMatch(hub, /food cost|gross profit|margin/i);
});

test("location analytics configuration is optional, server-only, and schema-validated", () => {
  assert.match(intelligence, /process\.env\.ANALYTICS_CONFIG_JSON/);
  assert.match(intelligence, /configurationMapSchema\.safeParse/);
  assert.match(intelligence, /parsed\.data\[locationId\]/);
  assert.match(read(".env.example"), /ANALYTICS_CONFIG_JSON=/);
  assert.doesNotMatch(filterBar + hub, /ANALYTICS_CONFIG_JSON/);
});

test("product momentum ignores tiny comparison samples and the time filter stays open", () => {
  assert.match(dashboard, /comparisonReceiptVolume/);
  assert.match(dashboard, /comparisonReceiptVolume >= momentumMinimum/);
  assert.match(dashboard, /getAnalyticsConfiguration\(filters, scope\)\.momentumMinReceipts/);
  assert.match(filterBar, /navigate\(\{ hourFrom:[\s\S]*\}, true\)/);
  assert.match(filterBar, /navigate\(\{ hourTo: event\.target\.value \|\| null \}, true\)/);
});

test("analytics controls are URL-backed, keyboard reachable, and support drill-through", () => {
  assert.match(filterBar, /params\.getAll\(key\)/);
  assert.match(filterBar, /aria-pressed=/);
  assert.match(filterBar, /hourFrom/);
  assert.match(filterBar, /analytics-active-filters/);
  assert.match(hub, /\/admin\/analytics\/sales/);
  assert.match(hub, /AnalyticsFullscreenButton/);
  assert.match(hub, /title=/);
  assert.match(filterBar, /RussianDateRangePicker/);
  assert.match(rangePicker, /aria-haspopup="dialog"/);
  assert.match(rangePicker, /Предыдущий месяц/);
  assert.doesNotMatch(filterBar + rangePicker, /type="date"/);
});

test("analytics category colors are stable and carry the same meaning across charts", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const palette = await import(${JSON.stringify(files.url("palette"))});
      console.log(JSON.stringify({
        shawarma: palette.getAnalyticsCategoryPalette("Шаурма"),
        shawarmaAgain: palette.getAnalyticsCategoryPalette("Шаурма с курицей"),
        burgers: palette.getAnalyticsCategoryPalette("Бургеры"),
        hotdogs: palette.getAnalyticsCategoryPalette("Хот-доги")
      }));
    `);
  } finally {
    files.cleanup();
  }
  assert.deepEqual(result.shawarma, result.shawarmaAgain);
  assert.notEqual(result.shawarma.accent, result.burgers.accent);
  assert.notEqual(result.burgers.accent, result.hotdogs.accent);
  assert.match(hub, /getAnalyticsCategoryPalette/);
  assert.doesNotMatch(hub, /index % 5|index % 3/);
});

test("product and category CSV reports are scoped, aggregated, and spreadsheet-safe", () => {
  assert.match(reportExport, /getAnalyticsScope/);
  assert.match(reportExport, /getAnalyticsReportRows/);
  assert.match(reportExport, /\^\[=\+\\-@\]/);
  assert.match(reportExport, /private, no-store/);
  assert.doesNotMatch(reportExport, /customer|phone|email/i);
});

test("TEST orders bypass stock only inside the explicit test branch", () => {
  const testStart = operationalMigration.indexOf("if v_order.is_test then");
  const readyStart = operationalMigration.indexOf("elsif p_status = 'ready' then", testStart);
  const testBranch = operationalMigration.slice(testStart, readyStart);
  const productionReadyBranch = operationalMigration.slice(readyStart, operationalMigration.indexOf("elsif p_status = 'cancelled'", readyStart));
  assert.match(testBranch, /склад, бонусы и фискализация не изменены/);
  assert.doesNotMatch(testBranch, /set_order_status_staff_atomic/);
  assert.match(productionReadyBranch, /set_order_status_staff_atomic/);
  assert.match(read("supabase/migrations/20260724110535_harden_mvp_security_and_legal.sql"), /Недостаточно остатков/);
  assert.match(operationalMigration, /where o\.id is null or not o\.is_test/);
});
