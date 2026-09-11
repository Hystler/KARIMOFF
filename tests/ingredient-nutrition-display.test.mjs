import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import ts from 'typescript';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { getIngredientNutritionDisplay, formatNutritionValue } = loadTypeScript('src/lib/ingredient-nutrition-display.ts');
const ingredient = {
  id: 'test', name: 'Тестовый ингредиент', unit: 'g', nutrition_basis_quantity: 100,
  calories_kcal: 200, proteins_g: 10, fats_g: 4, carbohydrates_g: 30
};
const empty = { calories_kcal: null, proteins_g: null, fats_g: null, carbohydrates_g: null };
const values = nutrition => nutrition.items.map(item => item.value);

test('nutrition display respects the stored basis for one unit, an extra and 100 g', () => {
  const display = getIngredientNutritionDisplay(ingredient, 50);
  assert.deepEqual(values(display.perUnit), [2, 0.1, 0.04, 0.3]);
  assert.deepEqual(values(display.perPortion), [100, 5, 2, 15]);
  assert.deepEqual(values(display.per100g), [200, 10, 4, 30]);
  const differentBasis = getIngredientNutritionDisplay({ ...ingredient, nutrition_basis_quantity: 50 });
  assert.deepEqual(values(differentBasis.per100g), [400, 20, 8, 60]);
});

test('exact reference fallback shares the recipe calculation and retains source quality', () => {
  const estimated = getIngredientNutritionDisplay({ ...ingredient, ...empty, name: 'Капуста' });
  assert.equal(estimated.per100g.items[0].value, 27.9);
  assert.equal(estimated.source.estimated, true);
  const label = getIngredientNutritionDisplay({ ...ingredient, ...empty, name: 'Котлета говяжья' }, 110);
  assert.equal(label.perPortion.items[0].value, 286);
  assert.equal(label.source.estimated, false);
});

test('known missing chicken patty, partial and invalid records are visibly incomplete', () => {
  for (const change of [empty, { proteins_g: null }, { fats_g: -1 }, { calories_kcal: Infinity }, { nutrition_basis_quantity: 0 }]) {
    const display = getIngredientNutritionDisplay({ ...ingredient, name: 'Котлета куриная', ...change });
    assert.equal(display.perUnit.complete, false);
    assert.equal(display.per100g.complete, false);
    assert.ok(display.issue);
  }
  assert.equal(getIngredientNutritionDisplay(null).issue, 'Нет данных ингредиента');
  const partialReference = getIngredientNutritionDisplay({ ...ingredient, ...empty, name: 'Капуста', calories_kcal: 0 });
  assert.equal(partialReference.source, null);
  assert.equal(partialReference.per100g.complete, false);
});

test('entered zeros remain known zeros and do not fall back to reference nutrition', () => {
  const display = getIngredientNutritionDisplay({ ...ingredient, name: 'Капуста', calories_kcal: 0, proteins_g: 0, fats_g: 0, carbohydrates_g: 0 });
  assert.deepEqual(values(display.per100g), [0, 0, 0, 0]);
  assert.equal(display.source, null);
  assert.equal(display.issue, null);
});

test('pieces and millilitres never acquire an invented gram weight from a name or package', () => {
  for (const unit of ['pcs', 'ml']) {
    const display = getIngredientNutritionDisplay({ ...ingredient, name: 'Порция 20 г', unit, package_size: 20 }, 2);
    assert.equal(display.perUnit.complete, true);
    assert.equal(display.perPortion.complete, true);
    assert.equal(display.per100g, null);
    assert.ok(display.massIssue);
  }
});

test('structured known piece masses convert buns from a unit to 100 g', () => {
  for (const [name, weight, caloriesPerPiece, caloriesPer100g] of [
    ['Булочка для бургера белая', 82, 213.2, 260],
    ['Булочка для бургера чёрная', 89, 240.3, 270],
    ['Булочка для хот-дога открытая', 60, 156, 260],
    ['Булочка для хот-дога закрытая', 60, 144, 240],
    ['Сыр Чеддер, ломтик', 10, 33, 330]
  ]) {
    const display = getIngredientNutritionDisplay({ ...ingredient, ...empty, name, unit: 'pcs', nutrition_basis_quantity: 1 });
    assert.equal(display.unitWeightG, weight);
    assert.equal(display.perUnit.items[0].value, caloriesPerPiece);
    assert.ok(Math.abs(display.per100g.items[0].value - caloriesPer100g) < 0.0001);
    assert.equal(display.massEstimated, false);
    assert.equal(display.per100g.estimated, false);
    assert.equal(display.massIssue, null);
  }
});

test('mass lookup remains exact and cannot mask partially entered piece nutrition', () => {
  const bun = { ...ingredient, name: 'Булочка для бургера белая', unit: 'pcs', nutrition_basis_quantity: 1 };
  const entered = getIngredientNutritionDisplay(bun);
  assert.equal(entered.perUnit.items[0].value, 200);
  assert.equal(entered.source, null);
  assert.ok(Math.abs(entered.per100g.items[0].value - 200 * 100 / 82) < 0.0001);
  const partial = getIngredientNutritionDisplay({ ...bun, fats_g: null });
  assert.equal(partial.per100g.complete, false);
  assert.equal(partial.per100g.sources.length, 0);
  assert.ok(partial.issue);
  for (const change of [{ name: `${bun.name} тест` }, { unit: 'ml' }]) {
    assert.equal(getIngredientNutritionDisplay({ ...bun, ...change }).per100g, null);
  }
});

test('estimated piece masses retain their estimate tag even with entered nutrition', () => {
  const bacon = { ...ingredient, name: 'Бекон жареный', unit: 'pcs', nutrition_basis_quantity: 1 };
  for (const input of [bacon, { ...bacon, ...empty }]) {
    const display = getIngredientNutritionDisplay(input);
    assert.equal(display.unitWeightG, 3);
    assert.equal(display.massEstimated, true);
    assert.equal(display.per100g.estimated, true);
  }
});

test('mismatched extra units and invalid portions cannot produce a valid portion total', () => {
  const mismatch = getIngredientNutritionDisplay(ingredient, 1, 'pcs');
  assert.equal(mismatch.perUnit.complete, false);
  assert.equal(mismatch.perPortion.complete, false);
  assert.equal(mismatch.issue, 'Единицы не совпадают');
  for (const quantity of [0, -1, NaN, Infinity]) {
    assert.equal(getIngredientNutritionDisplay(ingredient, quantity).perPortion.complete, false);
  }
});

test('small per-gram nutrition stays distinguishable from zero and missing values', () => {
  assert.equal(formatNutritionValue(0), '0');
  assert.equal(formatNutritionValue(null), 'Нет данных');
  assert.equal(formatNutritionValue(Infinity), 'Нет данных');
  assert.equal(formatNutritionValue(0.001), '0,001');
  assert.equal(formatNutritionValue(0.0001), '<0,001');
});

function loadComponent(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  const modules = { 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, ...imports };
  new Function('require', 'exports', code)(id => {
    if (id in modules) return modules[id];
    throw new Error(`Unexpected component import: ${id}`);
  }, exports);
  return exports;
}

const renderIngredients = [
  { ...ingredient, name: 'Котлета куриная', ...empty },
  { ...ingredient, id: 'bun', name: 'Булочка для бургера белая', unit: 'pcs', nutrition_basis_quantity: 1, ...empty },
  { ...ingredient, id: 'sauce', name: 'Соус чесночный', ...empty },
  { ...ingredient, id: 'unknown-piece', name: 'Штучный ингредиент без массы', unit: 'pcs', nutrition_basis_quantity: 1 },
  { ...ingredient, id: 'archived', name: 'Архивный ингредиент', is_active: false }
].map(value => ({ category: 'Мясо / полуфабрикаты', is_active: true, cost_per_unit: 0.8, waste_percent: 10, package_size: 1000, package_price: 800, sort_order: 100, ...value }));
const displayModule = loadTypeScript('src/lib/ingredient-nutrition-display.ts');
const componentModule = loadComponent('src/components/admin/IngredientNutritionDisplay.tsx', { '@/lib/ingredient-nutrition-display': displayModule });
const commonImports = {
  'next/link': { default: props => createElement('a', props) },
  'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
  '@/lib/admin-auth': { isAdminAuthenticated: async () => true, getCurrentStaff: async () => ({ role: 'owner' }) },
  '@/lib/ingredients': { getAdminIngredients: async () => ({ ingredients: renderIngredients, notConfigured: false, error: null }) },
  '@/lib/ingredient-nutrition-display': displayModule,
  '@/components/admin/IngredientNutritionDisplay': componentModule
};
const IngredientsPage = loadComponent('src/app/admin/ingredients/page.tsx', {
  ...commonImports,
  '@/components/admin/ConfirmSubmitButton': { ConfirmSubmitButton: ({ message, ...props }) => createElement('button', { ...props, 'data-confirm': message }) },
  '@/lib/inventory': {
    formatInventoryQuantity: (quantity, unit) => `${quantity} ${unit}`,
    getInventoryByIngredientIds: async () => ({ itemsByIngredient: new Map([['test', { current_quantity: 20, min_quantity: 30, unit: 'g' }]]) })
  },
  '../inventory/actions': { createInventoryItemAction: '/test/create-inventory' },
  '../login/actions': { logoutAction: '/test/logout' },
  './actions': { archiveIngredientAction: '/test/archive', toggleIngredientActiveAction: '/test/restore' }
}).default;
const ExtrasPage = loadComponent('src/app/admin/ingredients/extras/page.tsx', {
  ...commonImports,
  '@/lib/extras-service': { listExtrasCatalog: async () => renderIngredients.slice(0, 4).map(value => ({
    ingredient_id: value.id, name: value.name, label: `${value.name} · доп`, unit: value.unit,
    price: value.unit === 'g' ? '0' : '40', price_max: '50', quantity: value.unit === 'g' ? '50' : '1',
    cost: '0.8', waste: '10', product_count: 12, note: value.unit === 'pcs' ? 'Массу порции нужно сверить.' : null
  })) },
  './actions': { installExtrasAction: '/test/install-extras', updateExtraPriceAction: '/test/update-extra-price' }
}).default;
const renderedPages = {};

test('ingredient table renders missing nutrition and preserves inventory, archive and restore controls', async () => {
  const html = renderToStaticMarkup(await IngredientsPage({}));
  assert.match(html, /Порог закупки/);
  assert.match(html, /20 g/);
  assert.match(html, /30 g/);
  assert.match(html, /Низкий остаток/);
  assert.match(html, /Котлета куриная/);
  assert.match(html, /КБЖУ не заполнены/);
  assert.match(html, /213,2 ккал/);
  assert.match(html, /260 ккал/);
  assert.match(html, /Нет массы 1 шт\./);
  assert.match(html, /action="\/test\/archive"/);
  assert.match(html, /data-confirm="Переместить ингредиент/);
  assert.match(html, /action="\/test\/create-inventory"/);
  assert.match(html, /href="\/admin\/ingredients\/test\/edit"/);
  assert.doesNotMatch(html, /Архивный ингредиент/);
  assert.doesNotMatch(html, /href="\/admin\/ingredients\/extras"/);
  const archived = renderToStaticMarkup(await IngredientsPage({ searchParams: Promise.resolve({ view: 'archived' }) }));
  assert.match(archived, /Архивный ингредиент/);
  assert.match(archived, /action="\/test\/restore"/);
  assert.match(archived, /name="next_active" value="true"/);
  const error = renderToStaticMarkup(await IngredientsPage({ searchParams: Promise.resolve({ error: 'Отходы 100% недопустимы' }) }));
  assert.match(error, /Ошибка: Отходы 100% недопустимы/);
  renderedPages.ingredients = html;
});

test('extras table renders per-unit, portion and 100 g values with intact price actions and finite food cost', async () => {
  const html = renderToStaticMarkup(await ExtrasPage({ searchParams: Promise.resolve({}) }));
  assert.match(html, /<table/);
  assert.match(html, /КБЖУ \/ 1 ед\./);
  assert.match(html, /КБЖУ \/ доп/);
  assert.match(html, /КБЖУ \/ 100 г/);
  assert.match(html, /263,315 ккал/);
  assert.match(html, /КБЖУ: оценка/);
  assert.match(html, /action="\/test\/update-extra-price"/);
  assert.match(html, /action="\/test\/install-extras"/);
  assert.match(html, /name="ingredient_id" value="test"/);
  assert.match(html, /name="label" value="Котлета куриная · доп"/);
  assert.match(html, /<input(?=[^>]*name="price")(?=[^>]*required="")(?=[^>]*inputMode="decimal")/);
  assert.match(html, /Сохранение установит единую цену/);
  assert.doesNotMatch(html, /Infinity|NaN/);
  renderedPages.extras = html;
});

after(() => {
  const directory = process.env.NUTRITION_DISPLAY_PREVIEW_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  for (const [name, html] of Object.entries(renderedPages)) {
    writeFileSync(join(directory, `${name}.html`), `<!doctype html><html lang="ru" style="--font-manrope:system-ui"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="style.css"><body><div class="admin-root admin-workspace"><aside class="hidden lg:block"></aside><div class="min-w-0">${html}</div></div></body></html>`);
  }
});
