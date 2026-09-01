import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function fixture() {
  const cacheDirectory = join(root, ".next", "cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const directory = mkdtempSync(join(cacheDirectory, "karimoff-analytics-economics-test-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');

  const files = {
    "analytics-types": read("src/lib/analytics/types.ts"),
    "operating-hours": read("src/lib/analytics/operating-hours.ts"),
    "analytics-periods": read("src/lib/analytics/periods.ts")
      .replace('from "./types"', 'from "./analytics-types.ts"')
      .replace('from "./operating-hours"', 'from "./operating-hours.ts"'),
    "economics-values": read("src/lib/economics-values.ts"),
    "economics-input": read("src/lib/economics-input.ts")
      .replace('from "./economics-values"', 'from "./economics-values.ts"'),
    "management-result": read("src/lib/management-result.ts")
      .replace('from "./economics-values"', 'from "./economics-values.ts"'),
    "economics-validation": read("src/lib/economics-validation.ts")
      .replace('import "server-only";\n\n', "")
      .replace('from "./economics-input"', 'from "./economics-input.ts"')
      .replace('from "./economics-values"', 'from "./economics-values.ts"')
  };

  for (const [name, source] of Object.entries(files)) {
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

test("daily averages use selected Moscow calendar days, including weekday filters", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const periods = await import(${JSON.stringify(files.url("analytics-periods"))});
      const today = periods.getAnalyticsRange({ period: "today", now: new Date("2026-08-18T10:00:00Z") });
      const thirty = periods.getAnalyticsRange({ period: "30d", now: new Date("2026-08-18T10:00:00Z") });
      const week = periods.getAnalyticsRange({ period: "custom", dateFrom: "2026-08-17", dateTo: "2026-08-23" });
      console.log(JSON.stringify({
        today: periods.averagePerAnalyticsDay(12, today),
        thirty: periods.averagePerAnalyticsDay(300, thirty),
        mondays: periods.averagePerAnalyticsDay(8, week, [1]),
        emptyFilteredDay: periods.averagePerAnalyticsDay(8, today, [7])
      }));
    `);
  } finally {
    files.cleanup();
  }

  assert.deepEqual(result, { today: 12, thirty: 10, mondays: 8, emptyFilteredDay: 0 });
});

test("receipt average is explicitly POS-only while completed sales remain channel-neutral", () => {
  const dashboard = read("src/lib/analytics/dashboard.ts");
  const overview = read("src/components/admin/analytics/AnalyticsOverview.tsx");

  assert.match(dashboard, /s\.sale_count_eligible and s\.source = 'pos_evotor'/);
  assert.match(dashboard, /averageOrdersPerDay/);
  assert.match(dashboard, /averageReceiptsPerDay/);
  assert.match(overview, /Среднее заказов в день/);
  assert.match(overview, /Среднее чеков в день/);
  assert.match(overview, /Только фискальные POS-чеки/);
});

test("economics number editing accepts empty drafts, grouped paste, zero, and decimals", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const input = await import(${JSON.stringify(files.url("economics-input"))});
      console.log(JSON.stringify({
        empty: input.parseEconomicsNumber(""),
        zero: input.parseEconomicsNumber("0"),
        grouped: input.parseEconomicsNumber("1 250 000"),
        nbsp: input.parseEconomicsNumber("1\\u00a0250\\u00a0000,50"),
        decimal: input.parseEconomicsNumber("2,25"),
        invalid: input.parseEconomicsNumber("abc"),
        negative: input.parseEconomicsNumber("-1"),
        formatted: input.normalizeEconomicsNumberText(input.formatEconomicsDraft("100000"))
      }));
    `);
  } finally {
    files.cleanup();
  }

  assert.deepEqual(result, {
    empty: null,
    zero: 0,
    grouped: 1250000,
    nbsp: 1250000.5,
    decimal: 2.25,
    invalid: null,
    negative: null,
    formatted: "100000"
  });
});

test("economics server schema rejects empty, invalid, excessive, and fractional day values", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const values = await import(${JSON.stringify(files.url("economics-values"))});
      const validation = await import(${JSON.stringify(files.url("economics-validation"))});
      const check = (patch) => {
        const form = new FormData();
        for (const [key, value] of Object.entries({ ...values.defaultEconomicsValues, ...patch })) form.set(key, String(value));
        const parsed = validation.validateEconomicsFormData(form);
        return parsed.success ? { success: true, values: parsed.values } : { success: false, errors: parsed.fieldErrors };
      };
      console.log(JSON.stringify({
        zero: check({ average_check: 0 }),
        decimal: check({ acquiring_percent: "2,25" }),
        empty: check({ rent: "" }),
        invalid: check({ payroll: "abc" }),
        excessive: check({ tax_percent: 101 }),
        fractionalDays: check({ working_days_per_month: 20.5 })
      }));
    `);
  } finally {
    files.cleanup();
  }

  assert.equal(result.zero.success, true);
  assert.equal(result.zero.values.average_check, 0);
  assert.equal(result.decimal.success, true);
  assert.equal(result.decimal.values.acquiring_percent, 2.25);
  assert.equal(result.empty.success, false);
  assert.ok(result.empty.errors.rent);
  assert.equal(result.invalid.success, false);
  assert.ok(result.invalid.errors.payroll);
  assert.equal(result.excessive.success, false);
  assert.ok(result.excessive.errors.tax_percent);
  assert.equal(result.fractionalDays.success, false);
  assert.ok(result.fractionalDays.errors.working_days_per_month);
});

test("economics action exports only an async server action and returns controlled states", () => {
  const action = read("src/app/admin/economics/actions.ts");
  const component = read("src/components/admin/EconomicsCalculator.tsx");

  assert.match(action, /^"use server";/);
  assert.doesNotMatch(action, /export const/);
  assert.match(action, /export async function saveEconomicsSettingsAction/);
  assert.match(action, /validateEconomicsFormData/);
  assert.match(action, /catch \{/);
  assert.match(action, /Не удалось сохранить вводные/);
  assert.doesNotMatch(component, /Number\(event\.target\.value\)/);
  assert.match(component, /type="text"/);
  assert.match(component, /formatEconomicsDraft/);
  assert.match(component, /aria-live="polite"/);
});

test("actual management result separates POS and web acquiring and treats CAPEX below operations", () => {
  const files = fixture();
  let result;
  try {
    result = runTypeScript(`
      const management = await import(${JSON.stringify(files.url("management-result"))});
      const expenses = {
        acquiringPosPercent: 1,
        acquiringWebPercent: 3,
        capex: 500,
        marketing: 400,
        miscPercent: 0.5,
        other: 100,
        payroll: 2000,
        rent: 1000,
        royaltyPercent: 0,
        taxPercent: 6,
        utilities: 500
      };
      console.log(JSON.stringify(management.calculateManagementResult({
        coveredRevenue: 10000,
        grossProfit: 7000,
        posCoveredRevenue: 6000,
        webCoveredRevenue: 4000
      }, expenses)));
    `);
  } finally {
    files.cleanup();
  }

  assert.deepEqual(result, {
    cashResult: 1670,
    commissions: 830,
    fixedOpex: 4000,
    misc: 50,
    operatingResult: 2170,
    posAcquiring: 60,
    royalty: 0,
    tax: 600,
    webAcquiring: 120
  });
});

test("actual economics UI uses canonical covered sales and labels incomplete food cost honestly", () => {
  const query = read("src/lib/economics-actual.ts");
  const component = read("src/components/admin/ActualManagementResult.tsx");
  const page = read("src/app/admin/economics/page.tsx");
  const calendar = read("src/components/admin/RussianDateRangePicker.tsx");

  assert.match(query, /canonical_analytics_sales/);
  assert.match(query, /product_ingredients/);
  assert.match(query, /coalesce\(product_cost\.is_complete, false\)/);
  assert.match(component, /Управленческий результат/);
  assert.match(component, /Валовая прибыль по food cost/);
  assert.match(component, /Продажи на .* не включены в валовую прибыль/);
  assert.match(component, /Эквайринг кассы/);
  assert.match(component, /Эквайринг сайта/);
  assert.match(component, /Роялти для основной точки по умолчанию 0%/);
  assert.match(component, /parseEconomicsNumber\(value\) \?\? 0/);
  assert.match(component, /type="text"/);
  assert.match(component, /formatEconomicsDraft/);
  assert.doesNotMatch(component, /type="number"/);
  assert.match(page, /getActualManagementResult/);
  assert.match(page, /EconomicsPeriodFilter/);
  assert.match(page, /Плановый сценарий точки/);
  assert.doesNotMatch(component, /Чистая прибыль/);
  assert.match(calendar, /Intl\.DateTimeFormat\("ru-RU"/);
  assert.match(calendar, /Выберите период/);
  assert.doesNotMatch(page + calendar, /type="date"/);
});

test("analytics EXPLAIN diagnostics are fixed-query, admin-only, test-only, and read-only", () => {
  const route = read("src/app/api/admin/analytics/performance/route.ts");
  const performance = read("src/lib/analytics/performance.ts");

  assert.match(route, /process\.env\.TEST_ORDER_MODE !== "true"/);
  assert.match(route, /getAnalyticsScope/);
  assert.match(route, /scope\.role !== "owner"/);
  assert.match(performance, /set transaction read only/);
  assert.match(performance, /explain \(analyze, buffers, format json\)/);
  assert.match(performance, /statement_timeout/);
  assert.match(performance, /s\.analytics_included/);
  assert.doesNotMatch(performance, /s\.included_in_analytics/);
  assert.doesNotMatch(route, /request\.json|searchParams|get\("sql"\)/);
});
