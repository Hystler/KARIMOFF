import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260812153000_add_production_accounting.sql");
const productionPage = read("src/app/admin/production/page.tsx");
const productionRunForm = read("src/components/admin/ProductionRunForm.tsx");
const navigation = read("src/components/admin/AdminWorkspaceShell.tsx");

function runCalculation() {
  const moduleUrl = pathToFileURL(
    new URL("../src/lib/production-calculations.ts", import.meta.url).pathname
  ).href;
  const script = `
    const { calculateProductionMetrics } = await import(${JSON.stringify(moduleUrl)});
    const result = calculateProductionMetrics({
      batchDurationMinutes: 60,
      components: [{ costPerBaseUnit: 0.34, isPrimary: true, quantity: 600, unit: "kg" }],
      directExpenses: [{ amountPerBatch: 10000 }],
      monthlyOverhead: 300000,
      outputQuantity: 450,
      outputUnit: "kg",
      plannedBatchesPerMonth: 15,
      salePricePerOutputUnit: 650,
      totalPlannedMinutes: 900
    });
    console.log(JSON.stringify(result));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertClose(actual, expected, tolerance = 0.001) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("production card calculates yield, full cost, price per 100g, and margin", () => {
  const metrics = runCalculation();
  assertClose(metrics.materialCost, 204000);
  assert.equal(metrics.directCost, 10000);
  assert.equal(metrics.overheadPerBatch, 20000);
  assertClose(metrics.totalCost, 234000);
  assertClose(metrics.costPer100BaseUnits, 52);
  assert.equal(metrics.yieldPercent, 75);
  assert.equal(metrics.lossPercent, 25);
  assert.equal(metrics.plannedRevenue, 292500);
  assertClose(metrics.grossProfit, 58500);
  assertClose(metrics.grossMarginPercent, 20);
});

test("production run is atomic and cannot make raw inventory negative", () => {
  assert.match(migration, /create or replace function public\.complete_production_run_atomic/);
  assert.match(migration, /for update of inventory/);
  assert.match(migration, /Недостаточно сырья/);
  assert.match(migration, /production_consumption/);
  assert.match(migration, /production_output/);
  assert.match(migration, /update public\.ingredients[\s\S]+cost_per_unit = v_weighted_output_cost/);
  assert.match(migration, /Выходной полуфабрикат нельзя использовать как сырьё/);
  assert.match(migration, /insert into public\.production_run_items/);
});

test("production tables are private and available to the server-only app role", () => {
  assert.match(migration, /alter table public\.production_recipes enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.%I from anon/);
  assert.match(migration, /to karimoff_app using \(true\) with check \(true\)/);
  assert.match(migration, /grant execute on function public\.complete_production_run_atomic/);
});

test("production is a first-class admin section with OPEX and actual runs", () => {
  assert.match(navigation, /href: "\/admin\/production"/);
  assert.match(productionPage, /Карты производства/);
  assert.match(productionPage, /Новый ежемесячный расход/);
  assert.match(productionRunForm, /Зафиксировать выпуск/);
  assert.match(productionPage, /Канцелярия/);
});
