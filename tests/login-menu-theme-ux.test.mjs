import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("cart auth navigation closes the drawer and checkout loading always recovers", () => {
  const drawer = read("src/components/cart/CartDrawer.tsx");

  assert.match(drawer, /const leaveCartForAuth = useCallback/);
  assert.match(drawer, /setMode\("cart"\);[\s\S]+closeCart\(\);/);
  assert.match(drawer, /href="\/login\?redirectTo=%2Fcheckout"[\s\S]{0,120}onClick=\{leaveCartForAuth\}/);
  assert.match(drawer, /href="\/register\?redirectTo=%2Fcheckout"[\s\S]{0,120}onClick=\{leaveCartForAuth\}/);
  assert.match(drawer, /checkoutContextPending\.current/);
  assert.match(drawer, /CHECKOUT_CONTEXT_TIMEOUT/);
  assert.match(drawer, /finally \{[\s\S]+setIsCustomerLoading\(false\)/);
  assert.match(drawer, /checkoutContextError/);
  assert.match(drawer, /\{mode === "cart" \? \(/);
  assert.doesNotMatch(drawer, /mode === "cart" \|\| mode === "auth"/);
});

test("public theme follows the device until the guest makes a manual choice", () => {
  const provider = read("src/components/theme/ThemeProvider.tsx");
  const layout = read("src/app/layout.tsx");

  assert.match(provider, /karimoff_theme_preference_v2/);
  assert.match(provider, /prefers-color-scheme: dark/);
  assert.match(provider, /media\.addEventListener\("change", handleChange\)/);
  assert.match(provider, /window\.localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(layout, /karimoff_theme_preference_v2/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /document\.documentElement\.dataset\.theme = theme/);
});

test("every imported menu item has concise guest copy separated from composition", () => {
  const imported = JSON.parse(read("data/import/juikaifui-products.json"));
  const copy = JSON.parse(read("data/catalog/public-product-copy.json"));
  const copyByAlias = new Map(
    Object.values(copy).flatMap((entry) => entry.aliases.map((alias) => [alias, entry]))
  );

  for (const product of imported.filter((entry) => entry.is_active)) {
    const entry = copyByAlias.get(product.slug);
    assert.ok(entry, `Missing public copy for ${product.slug}`);
    assert.ok(entry.name.length <= 38, `Product name is too long: ${entry.name}`);
    assert.ok(entry.description.length <= 115, `Description is too long: ${entry.name}`);
    assert.doesNotMatch(entry.description, /^(?:Состав:|Пшеничная булочка,|Лаваш тандырный,|Тандырная лепешка,)/i);
  }
});

test("inactive drinks stay out of public menu and product detail fallbacks", () => {
  const imported = JSON.parse(read("data/import/juikaifui-products.json"));
  const products = read("src/lib/products.ts");
  const drinks = imported.filter((entry) => entry.category === "Напитки");

  assert.equal(drinks.length, 8);
  assert.ok(drinks.every((entry) => entry.is_active === false));
  assert.match(products, /const fallbackActiveProducts = fallbackProducts\.filter\(\(product\) => product\.is_active\)/);
  assert.match(products, /return fallbackActiveProducts\.slice\(0, limit\)/);
  assert.match(products, /return fallbackActiveBySlug\.get\(slug\) \?\? null/);
  assert.match(read("src/app/menu/page.tsx"), /availableCategoryFilters/);
});

test("catalog copy migration is one-time, slug-based, and leaves business values intact", () => {
  const copy = JSON.parse(read("data/catalog/public-product-copy.json"));
  const migration = read("supabase/migrations/20260828190000_refine_public_product_copy.sql");
  const runtime = read("scripts/apply-runtime-schema-migrations.mjs");
  const dockerfile = read("Dockerfile");

  for (const entry of Object.values(copy)) {
    assert.match(migration, new RegExp(entry.aliases[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(migration.includes(entry.name));
    assert.ok(migration.includes(entry.description));
  }

  assert.match(migration, /product\.slug = any\(public_copy\.aliases\)/);
  assert.match(migration, /set\s+name = public_copy\.name,\s+description = public_copy\.description,/);
  assert.doesNotMatch(migration, /\bprice\s*=|\bis_active\s*=|\bimage_url\s*=|product_ingredients|inventory_/);
  assert.match(runtime, /20260828190000_refine_public_product_copy/);
  assert.match(runtime, /schema_migration\.20260828190000_refine_public_product_copy/);
  assert.match(dockerfile, /20260828190000_refine_public_product_copy\.sql/);
});

test("menu cards show complete guest copy and use a readable mobile layout", () => {
  const card = read("src/components/ProductCard.tsx");
  const menu = read("src/app/menu/page.tsx");
  const popular = read("src/components/PopularMenu.tsx");
  const styles = read("src/app/globals.css");

  assert.match(card, /min-w-0/);
  assert.doesNotMatch(card, /line-clamp-[23]/);
  assert.match(card, /overflow-wrap-anywhere/);
  assert.match(menu, /grid-cols-1 gap-4 min-\[520px\]:grid-cols-2/);
  assert.match(popular, /grid-cols-1 gap-4 min-\[520px\]:grid-cols-2/);
  assert.match(card, /calc\(100vw - 2\.5rem\)/);
  assert.match(styles, /\.overflow-wrap-anywhere\s*\{\s*overflow-wrap: anywhere;/);
});

test("public actions share premium accessible states without touching provider branding", () => {
  const styles = read("src/app/globals.css");
  const header = read("src/components/Header.tsx");
  const product = read("src/components/products/ProductCustomizer.tsx");
  const checkout = read("src/components/cart/CartDrawer.tsx");
  const telegram = read("src/components/auth/TelegramLoginButton.tsx");
  const max = read("src/components/auth/MaxLoginButton.tsx");

  assert.match(styles, /\.public-button-primary/);
  assert.match(styles, /\.public-button-secondary/);
  assert.match(styles, /\.public-icon-button/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /\.public-button-primary:disabled/);
  assert.match(styles, /@media \(hover: hover\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(header, /public-icon-button/);
  assert.match(product, /public-button-primary product-cta/);
  assert.match(checkout, /public-button-primary/);
  assert.match(telegram, /bg-\[#229ED9\]/);
  assert.match(max, /bg-\[#471AFF\]/);
});
