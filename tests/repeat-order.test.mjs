import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { prepareRepeatOrder } = loadTypeScript("src/lib/repeat-order.ts");
const { buildReplacementCartLines } = loadTypeScript("src/lib/replacement-cart.ts");
const product = {
  id: "product", slug: "current-slug", name: "Актуальный товар", price: 350, image_url: "/current.jpg", is_active: true,
  modifier_options: [{ ingredient_id: "cheese", name: "Сыр", is_removable: true, is_extra_available: true, extra_price: 60, extra_quantity: 25, max_extra_quantity: 3 }],
  modifier_groups: [{ id: "size", min_selections: 1, max_selections: 1, options: [{ id: "large", label: "Большая", price_delta: 80 }] }]
};
const item = {
  id: "item", product_id: "product", product_name: "Старое название", quantity: 2, unit_price: 100, item_note: "Без острого",
  configuration_snapshot: { removed_ingredient_ids: ["cheese"], extras: [{ ingredient_id: "cheese", quantity: 2 }], modifier_option_ids: ["large"] }, modifiers: []
};

test("repeat restores exact current product, options, serving counts and notes using current prices", () => {
  const result = prepareRepeatOrder([item], [product]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.items[0].product.price, 350);
  assert.equal(result.items[0].product.slug, "current-slug");
  assert.deepEqual(result.items[0].customization, { removed: [{ ingredient_id: "cheese", name: "Сыр" }], extras: [{ ingredient_id: "cheese", name: "Сыр", quantity: 2, unit_price: 60 }], modifierOptionIds: ["large"], note: "Без острого" });
  assert.equal(buildReplacementCartLines(result.items)[0].quantity, 2);
});

test("discontinued products and deleted modifiers remain explicit and never silently reset to defaults", () => {
  const result = prepareRepeatOrder([item, { ...item, id: "missing", product_id: null }, { ...item, id: "deleted", configuration_snapshot: { ...item.configuration_snapshot, modifier_option_ids: ["old-option"] } }], [product]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.issues.map(issue => issue.itemId), ["missing", "deleted"]);
  assert.match(result.issues[0].reason, /недоступен/);
  assert.match(result.issues[1].reason, /Состав изменился/);
});

test("required choice, current extra limits and unavailable ingredients prevent invalid restoration", () => {
  for (const configuration_snapshot of [
    { ...item.configuration_snapshot, modifier_option_ids: [] },
    { ...item.configuration_snapshot, extras: [{ ingredient_id: "cheese", quantity: 4 }] },
    { ...item.configuration_snapshot, removed_ingredient_ids: ["deleted"] }
  ]) {
    const result = prepareRepeatOrder([{ ...item, configuration_snapshot }], [product]);
    assert.equal(result.items.length, 0);
    assert.equal(result.issues.length, 1);
  }
});

test("legacy modifier IDs are restored, but old extra gram counts are never guessed", () => {
  const old = { ...item, configuration_snapshot: null, modifiers: [{ modifier_option_id: "large", ingredient_id: null, modifier_type: "replace", quantity: 0 }] };
  assert.deepEqual(prepareRepeatOrder([old], [product]).items[0].customization.modifierOptionIds, ["large"]);
  assert.deepEqual(prepareRepeatOrder([{ ...old, configuration_snapshot: {} }], [product]).items[0].customization.modifierOptionIds, ["large"]);
  assert.equal(prepareRepeatOrder([{ ...old, modifiers: [...old.modifiers, { ingredient_id: "cheese", modifier_option_id: null, modifier_type: "add", quantity: 50 }] }], [product]).issues.length, 1);
});

test("replacement is a complete next cart, merges equal configurations, and never truncates quantities", () => {
  const next = prepareRepeatOrder([item], [product]).items[0];
  const current = [{ product: { id: "unrelated" }, quantity: 10 }];
  const replacement = buildReplacementCartLines([next, next]);
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0].quantity, 4);
  assert.equal(replacement[0].product.id, "product");
  assert.equal(current[0].product.id, "unrelated");
  assert.throws(() => buildReplacementCartLines([{ ...next, quantity: 15 }, next, { ...next, quantity: 8 }]), /20/);
});

test("repeat queries ownership before items and reuses authenticated no-store route, never creates orders", async () => {
  const calls = [];
  const database = { from(table) {
    const query = { select() { return query; }, eq(field, value) { calls.push([table, field, value]); return query; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
    return query;
  } };
  const { getCustomerRepeatOrder } = loadTypeScript("src/lib/customer-repeat-order.ts", {
    "server-only": {}, "@/lib/database/server": { createDatabaseServerClient: () => database },
    "@/lib/products": { getActiveProductsByIds: () => { throw new Error("Must not resolve another customer's products"); } },
    "@/lib/repeat-order": { prepareRepeatOrder }
  });
  assert.equal(await getCustomerRepeatOrder("customer-a", "order-b"), null);
  assert.deepEqual(calls, [["orders", "id", "order-b"], ["orders", "customer_id", "customer-a"]]);
  const route = readFileSync("src/app/api/customer/orders/[orderId]/repeat/route.ts", "utf8");
  assert.match(route, /getCurrentCustomer/);
  assert.match(route, /status: 401/);
  assert.match(route, /no-store/);
  assert.doesNotMatch(route, /createOrder|POST|insert|update/);
});

test("a mounted cart replacement survives delayed storage hydration and checkout reads the complete new state", () => {
  const slots = [];
  const effects = [];
  let cursor = 0;
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useCallback: callback => { cursor++; return callback; },
    useContext: () => null,
    useMemo: callback => { cursor++; return callback(); },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef: initial => {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      const prior = slots[index];
      if (!prior || dependencies.some((value, i) => value !== prior[i])) effects.push(callback);
      slots[index] = dependencies;
    }
  };
  const timers = [];
  const values = new Map([["karimoff_cart", JSON.stringify([{ product: { id: "old", slug: "old", name: "Old", price: 10 }, quantity: 1 }])]]);
  const pushes = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    location: { pathname: "/profile", search: "", hash: "" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
  };
  try {
    // Transpile the real TSX provider with a minimal deterministic hook scheduler, no UI framework added.
    const code = ts.transpileModule(readFileSync("src/components/cart/CartProvider.tsx", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText;
    const exports = {};
    const modules = {
      react, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
      "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
      "@/lib/cart-checkout-storage": { CART_STORAGE_KEY: "karimoff_cart" },
      "@/lib/cart-line-key": loadTypeScript("src/lib/cart-line-key.ts"),
      "@/lib/replacement-cart": { buildReplacementCartLines },
      "@/lib/repeat-order-notice": { readRepeatOrderNotice: () => [], saveRepeatOrderNotice() {} }
    };
    new Function("require", "exports", code)(id => { if (id in modules) return modules[id]; throw new Error(id); }, exports);
    const render = () => { cursor = 0; return exports.CartProvider({ children: null }).props.value; };
    const runEffects = () => { while (effects.length) effects.shift()(); };
    const oldCart = render();
    runEffects(); // schedules the original zero-delay hydration read
    const prepared = prepareRepeatOrder([item], [product]).items;
    oldCart.replaceCart(prepared);
    runEffects();
    timers.forEach(callback => callback()); // old hydration must not overwrite the replacement
    const next = render();
    runEffects();
    assert.equal(next.lines.length, 1);
    assert.equal(next.lines[0].product.id, "product");
    assert.equal(next.lines[0].quantity, 2);
    assert.deepEqual(next.lines[0].customization.modifierOptionIds, ["large"]);
    assert.equal(JSON.parse(values.get("karimoff_cart"))[0].product.slug, "current-slug");
    next.checkout();
    assert.deepEqual(pushes, ["/checkout"]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("delivery-fee service lines are excluded while unavailable food items stay explicit", async () => {
  const rows = [
    { ...item, item_type: "food" },
    { ...item, id: "gone-food", product_id: null, product_name: "Удалённая шаурма", item_type: "food" },
    { ...item, id: "delivery", product_id: null, product_name: "Доставка", item_type: "delivery_fee" }
  ];
  const filters = [];
  const database = { from(table) {
    const predicates = [];
    const query = {
      select() { return query; },
      eq(field, value) { predicates.push([field, value]); filters.push([table, field, value]); return query; },
      in() { return query; },
      order() { return query; },
      maybeSingle: async () => ({ data: { id: "order", payment_status: "paid" }, error: null }),
      then(resolve) {
        const data = table === "order_items" ? rows.filter(row => predicates.every(([field, value]) => field === "order_id" || row[field] === value)) : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      }
    };
    return query;
  } };
  const { getCustomerRepeatOrder } = loadTypeScript("src/lib/customer-repeat-order.ts", {
    "server-only": {}, "@/lib/database/server": { createDatabaseServerClient: () => database },
    "@/lib/products": { getActiveProductsByIds: async () => [product] }, "@/lib/repeat-order": { prepareRepeatOrder }
  });
  const result = await getCustomerRepeatOrder("customer", "order");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.issues.map(issue => issue.name), ["Удалённая шаурма"]);
  assert.ok(filters.some(([table, field, value]) => table === "order_items" && field === "item_type" && value === "food"));
});

test("omitted-item notice survives reload and cart edits but clears on replacement or a different cart", () => {
  const { readRepeatOrderNotice, saveRepeatOrderNotice } = loadTypeScript("src/lib/repeat-order-notice.ts");
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
  try {
    const issues = [{ itemId: "gone", name: "Шаурма", reason: "Сейчас недоступен в меню" }];
    saveRepeatOrderNotice("cart-a", issues);
    assert.deepEqual(readRepeatOrderNotice("cart-a"), issues);
    assert.deepEqual(readRepeatOrderNotice("unrelated-cart"), []);
    saveRepeatOrderNotice("cart-a-edited", issues);
    assert.deepEqual(readRepeatOrderNotice("cart-a-edited"), issues);
    saveRepeatOrderNotice("[]", []);
    assert.deepEqual(readRepeatOrderNotice("cart-a-edited"), []);
  } finally { globalThis.window = previousWindow; }
});
