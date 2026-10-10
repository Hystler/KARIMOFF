import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { orderHomeMenu, homeFeaturedProductSlugs } = loadTypeScript('src/lib/home-menu-order.ts');
const categories = loadTypeScript('src/lib/product-categories.ts');

test('home keeps the exact verified editorial four, then the entire original catalog without duplicates', () => {
  const products = ['other', ...[...homeFeaturedProductSlugs].reverse(), 'last'].map((slug, i) => ({ id: String(i), slug }));
  assert.deepEqual(orderHomeMenu(products).map(p => p.slug), [...homeFeaturedProductSlugs, 'other', 'last']);
  assert.deepEqual(products.map(p => p.slug), ['other', ...[...homeFeaturedProductSlugs].reverse(), 'last']);
  assert.equal(orderHomeMenu(products.filter(p => p.slug !== 'tayson')).length, products.length - 1);
});

test('hot dogs have their own public and admin category, never snacks', () => {
  for (const category of ['Хот-Доги', 'хот дог', 'хотдог', 'Hot Dogs', 'hot-dogs']) assert.equal(categories.normalizeProductCategory(category), 'hotdogs');
  assert.equal(categories.normalizeProductCategory('Снэки'), 'snacks');
  assert.ok(categories.menuCategoryFilters.some(filter => filter.value === 'hotdogs'));
  assert.ok(categories.adminProductCategoryOptions.includes('Хот-Доги'));
});

function loadTsx(file, imports) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  new Function('require', 'exports', code)(id => { if (id in imports) return imports[id]; throw new Error(id); }, exports);
  return exports;
}
const jsx = (type, props) => ({ type, props });
const react = { createContext: () => ({}), useState: initial => [initial, () => {}], useEffect() {} };
const cart = loadTsx('src/components/cart/CartProvider.tsx', {
  react, 'react/jsx-runtime': { jsx }, 'next/navigation': {},
  '@/lib/cart-line-key': loadTypeScript('src/lib/cart-line-key.ts'),
  '@/lib/replacement-cart': {}, '@/lib/repeat-order-notice': {}, '@/lib/cart-checkout-storage': { CART_STORAGE_KEY: 'karimoff_cart' }
});

for (const scenario of [
  { name: 'a configurable product with a valid default adds directly', min: 1, defaults: true, adds: 1 },
  { name: 'a mandatory choice without a default opens the modal and never adds', min: 1, defaults: false, adds: 0 },
  { name: 'an optional choice without a default adds directly', min: 0, defaults: false, adds: 1 }
]) test(scenario.name, () => {
  const adds = [], opens = [];
  const product = { id: 'p', name: 'Товар', slug: 'product', price: 300,
    modifier_options: [{ ingredient_id: 'cheese', is_removable: true, is_extra_available: true }],
    modifier_groups: [{ id: 'g', min_selections: scenario.min, max_selections: 1, options: [{ id: 'o', is_default: scenario.defaults }] }] };
  const { ProductCustomizer } = loadTsx('src/components/products/ProductCustomizer.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Check: 'check', SlidersHorizontal: 'settings' },
    '@/components/cart/CartProvider': { ...cart, useCart: () => ({ addItem: (...args) => adds.push(args) }) }
  });
  const tree = ProductCustomizer({ product, onCustomize: () => opens.push('open') });
  const [primary, settings] = tree.props.children;
  primary.props.onClick();
  assert.equal(adds.length, scenario.adds);
  assert.equal(opens.length, scenario.adds ? 0 : 1);
  if (scenario.adds) assert.deepEqual(adds[0][1].modifierOptionIds, scenario.defaults ? ['o'] : []);
  settings.props.onClick();
  assert.equal(opens.length, scenario.adds ? 1 : 2);
  assert.equal(settings.props['aria-haspopup'], 'dialog');
});
