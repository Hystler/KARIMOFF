import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

function loadComponent(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  const modules = { 'react/jsx-runtime': jsxRuntime, ...imports };
  new Function('require', 'exports', code)(id => {
    if (id in modules) return modules[id];
    throw new Error(`Unexpected component import: ${id}`);
  }, exports);
  return exports;
}

const product = {
  id: 'product-1',
  name: 'Шаурма с курицей',
  slug: 'chicken-shawarma',
  category: 'shawarma',
  description: null,
  price: 260,
  image_url: null,
  is_active: true,
  sort_order: 10,
  weight: null,
  tags: null,
  calories: null,
  protein: null,
  fat: null,
  carbs: null,
  allergens: ['глютен']
};

const foodCost = {
  product,
  lines: [{ id: 'line-1' }],
  is_complete: true,
  missing_price_ingredients: [],
  food_cost: 78,
  food_cost_percent: 30,
  gross_profit: 182,
  gross_margin_percent: 70,
  nutrition: {
    available: true,
    complete: true,
    missingIngredients: [],
    estimated: false,
    sources: [],
    items: [
      { key: 'calories', label: 'Калорийность', unit: 'ккал', value: 520 },
      { key: 'protein', label: 'Белки', unit: 'г', value: 30 },
      { key: 'fat', label: 'Жиры', unit: 'г', value: 20 },
      { key: 'carbs', label: 'Углеводы', unit: 'г', value: 40 }
    ]
  }
};

const AdminProductsPage = loadComponent('src/app/admin/products/page.tsx', {
  'next/link': {
    default: ({ href, children, ...props }) => createElement('a', { ...props, href: typeof href === 'string' ? href : String(href) }, children)
  },
  'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
  '@/components/admin/ConfirmSubmitButton': {
    ConfirmSubmitButton: ({ children, ...props }) => createElement('button', props, children)
  },
  '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
  '@/lib/ingredients': { getProductsFoodCosts: async () => ({ items: [foodCost], notConfigured: false, error: null }) },
  '@/lib/products': { getAdminProducts: async () => ({ products: [product], notConfigured: false, error: null }) },
  '../login/actions': { logoutAction: '/test/logout' },
  './actions': { deleteProductAction: '/test/delete', toggleProductActiveAction: '/test/toggle' }
}).default;

test('admin menu list shows product calories and macros', async () => {
  const html = renderToStaticMarkup(await AdminProductsPage({ searchParams: Promise.resolve({}) }));

  assert.match(html, /КБЖУ/);
  assert.match(html, /КБЖУ на порцию/);
  assert.match(html, /520 ккал/);
  assert.match(html, /Б 30 \/ Ж 20 \/ У 40/);
  assert.match(html, /admin-product-nutrition/);
});

test('dark admin analytics cards use dark theme surfaces instead of light cards', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  assert.match(css, /html\[data-theme="dark"\] \.admin-root :where\([\s\S]*\.analytics-pair-grid article/);
  assert.match(css, /\.analytics-pair-grid article,[\s\S]*background: var\(--admin-surface-raised\) !important;/);
  assert.match(css, /html\[data-theme="dark"\] \.admin-root \.analytics-panel-note[\s\S]*background: rgba\(146, 64, 14, 0\.22\) !important;/);
});
