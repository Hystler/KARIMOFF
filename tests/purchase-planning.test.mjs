import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

async function load(path) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const { buildPurchasePlan } = await load("src/lib/analytics/planning-math.ts");
const { canUnlinkPublicSocialMethod } = await load("src/lib/auth/social/linking-rules.ts");
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const ingredient = (overrides = {}) => ({ id: "cabbage", name: "Cabbage", unit: "g", wastePercent: 20, cost: 0.035, packageSize: 1000, stock: 500, reserved: 100, minimum: 0, active: true, ...overrides });
const input = (overrides = {}) => ({
  sales: Array.from({ length: 7 }, (_, weekday) => ({ productId: "shawarma", name: "Shawarma", weekday, quantity: 4, active: true })),
  ingredients: [ingredient()], recipes: [{ productId: "shawarma", ingredientId: "cabbage", quantity: 80, unit: "g" }],
  weekdaySamples: Array(7).fill(4), futureWeekdays: Array.from({ length: 366 }, (_, i) => (i + 1) % 7), horizon: 7, bufferDays: 1, ...overrides
});

test("recipe decomposition applies waste once, subtracts reservations and rounds packages up", () => {
  const plan = buildPurchasePlan(input());
  const row = plan.rows[0];
  assert.equal(plan.days, 28);
  assert.equal(plan.products[0].perDay, 1);
  assert.equal(plan.products[0].forecast, 7);
  assert.equal(row.perDay, 100);
  assert.equal(row.demand, 700);
  assert.equal(row.target, 800);
  assert.equal(row.available, 400);
  assert.equal(row.daysLeft, 4);
  assert.equal(row.shortage, 400);
  assert.equal(row.packages, 1);
  assert.equal(row.purchase, 1000);
  assert.equal(row.budget, 35);
});

test("weekday rates include zero-sale days and use the exact future weekday sequence", () => {
  const plan = buildPurchasePlan(input({ sales: [{ productId: "shawarma", name: "Shawarma", weekday: 6, quantity: 40, active: true }], horizon: 1 }));
  approx(plan.products[0].perDay, 40 / 28);
  assert.equal(plan.products[0].forecast, 0); // Monday, not an averaged Saturday.
  assert.equal(plan.rows[0].demand, 0);
  approx(plan.rows[0].daysLeft, 5.4);
});

test("1, 2, 3, 7 and 14 day horizons and safety stock share one calculation", () => {
  for (const horizon of [1, 2, 3, 7, 14]) {
    const plan = buildPurchasePlan(input({ horizon, ingredients: [ingredient({ minimum: 25 })] }));
    assert.equal(plan.rows[0].demand, horizon * 100);
    assert.equal(plan.rows[0].target, (horizon + 1) * 100 + 25);
  }
});

test("unknown stock or price never silently becomes zero cost or a confident purchase recommendation", () => {
  const unknownStock = buildPurchasePlan(input({ ingredients: [ingredient({ stock: null })] }));
  assert.equal(unknownStock.rows[0].purchase, null);
  assert.equal(unknownStock.rows[0].daysLeft, null);
  assert.equal(unknownStock.missingStock, 1);
  const unknownPrice = buildPurchasePlan(input({ ingredients: [ingredient({ cost: 0 })] }));
  assert.equal(unknownPrice.rows[0].budget, null);
  assert.equal(unknownPrice.missingPrices, 1);
});

test("unmapped, inactive and incomplete products are surfaced and not partially decomposed", () => {
  for (const overrides of [
    { sales: [{ productId: null, name: "Unknown", weekday: 1, quantity: 10, active: true }] },
    { sales: [{ productId: "shawarma", name: "Inactive", weekday: 1, quantity: 10, active: false }] },
    { recipes: [] },
    { recipes: [...input().recipes, { productId: "shawarma", ingredientId: "missing", quantity: 1, unit: "pcs" }] },
    { ingredients: [ingredient({ unit: "ml" })] },
    { ingredients: [ingredient({ wastePercent: 100 })] }
  ]) {
    const plan = buildPurchasePlan(input(overrides));
    assert.equal(plan.coverage, 0);
    assert.equal(plan.rows.length, 0);
    assert.ok(plan.products.every((product) => product.issue));
  }
});

test("shared ingredients aggregate across dishes and reads leave inventory input unchanged", () => {
  const data = input();
  data.sales.push({ productId: "burger", name: "Burger", weekday: 1, quantity: 4, active: true });
  data.recipes.push({ productId: "burger", ingredientId: "cabbage", quantity: 40, unit: "g" });
  const before = JSON.stringify(data);
  const plan = buildPurchasePlan(data);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].demand, 750);
  assert.equal(JSON.stringify(data), before);
});

test("whole-piece purchases round up but preserve fractional average usage", () => {
  const plan = buildPurchasePlan(input({
    sales: [{ productId: "shawarma", name: "Shawarma", weekday: 1, quantity: 1, active: true }],
    recipes: [{ productId: "shawarma", ingredientId: "cabbage", quantity: 1, unit: "pcs" }],
    ingredients: [ingredient({ unit: "pcs", wastePercent: 0, packageSize: null, stock: 0, reserved: 0 })], horizon: 1, bufferDays: 0
  }));
  approx(plan.rows[0].perDay, 1 / 28);
  assert.equal(plan.rows[0].demand, 0.25);
  assert.equal(plan.rows[0].purchase, 1);
});

test("empty history, excessive reservations and exact package boundaries are safe", () => {
  assert.equal(buildPurchasePlan(input({ sales: [] })).coverage, null);
  const exhausted = buildPurchasePlan(input({ ingredients: [ingredient({ reserved: 600 })] }));
  assert.equal(exhausted.rows[0].available, 0);
  assert.equal(exhausted.rows[0].daysLeft, 0);
  const exact = buildPurchasePlan(input({ horizon: 7, bufferDays: 3, ingredients: [ingredient({ stock: 0, reserved: 0 })] }));
  assert.equal(exact.rows[0].packages, 1);
  assert.throws(() => buildPurchasePlan(input({ weekdaySamples: Array(7).fill(0) })));
  assert.throws(() => buildPurchasePlan(input({ horizon: 100 })));
});

test("social-only account cannot disconnect its last enabled messenger", () => {
  const both = { telegram: true, max: true };
  assert.equal(canUnlinkPublicSocialMethod(["telegram"], "telegram", both), false);
  assert.equal(canUnlinkPublicSocialMethod(["telegram", "phone", "vk"], "telegram", both), false);
  assert.equal(canUnlinkPublicSocialMethod(["telegram", "max"], "telegram", both), true);
  assert.equal(canUnlinkPublicSocialMethod(["telegram", "max"], "max", both), true);
  assert.equal(canUnlinkPublicSocialMethod(["telegram", "max"], "telegram", { telegram: true, max: false }), false);
});
