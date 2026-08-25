import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
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

test("product details use stable active slugs and expose complete SEO metadata", () => {
  const products = read("src/lib/products.ts");
  const page = read("src/app/menu/[slug]/page.tsx");
  assert.match(products, /getActiveProductBySlug/);
  assert.match(products, /\.eq\("slug", slug\)[\s\S]+\.eq\("is_active", true\)/);
  assert.doesNotMatch(products, /description: product\.description \|\| fallback\.description/);
  assert.doesNotMatch(products, /weight: product\.weight \|\| fallback\.weight/);
  assert.match(page, /if \(!product\)[\s\S]+notFound\(\)/);
  assert.match(page, /alternates: \{ canonical \}/);
  assert.match(page, /openGraph:/);
  assert.match(page, /"@type": "Product"/);
  assert.match(page, /getPublicProductComposition/);
  assert.doesNotMatch(page, /food_cost|cost_per_unit|line_cost/);
});

test("nutrition distinguishes missing data from real zero values", () => {
  const moduleUrl = pathToFileURL(join(root, "src/lib/product-nutrition.ts")).href;
  const result = runTypeScript(`
    const { getProductNutrition } = await import(${JSON.stringify(moduleUrl)});
    const absent = getProductNutrition({ calories: null, protein: null, fat: null, carbs: null });
    const present = getProductNutrition({ calories: 0, protein: 12.5, fat: null, carbs: 30 });
    console.log(JSON.stringify({ absent, present }));
  `);
  assert.equal(result.absent.available, false);
  assert.equal(result.present.available, true);
  assert.equal(result.present.items.find((item) => item.key === "calories").value, 0);
  assert.equal(result.present.items.find((item) => item.key === "fat").value, null);
});

test("listing and detail keep quick add, quantity, and server-authoritative modifiers", () => {
  const card = read("src/components/ProductCard.tsx");
  const listingAdd = read("src/components/products/ProductCustomizer.tsx");
  const detail = read("src/components/products/ProductDetailPurchase.tsx");
  const drawer = read("src/components/cart/CartDrawer.tsx");
  const schema = read("src/lib/order-schema.ts");
  assert.match(card, /href=\{href\}/);
  assert.match(listingAdd, /addItem\(product, customization\)/);
  assert.match(detail, /addItem\(product, customization, quantity\)/);
  assert.match(detail, /modifierOptionIds/);
  assert.match(detail, /Убрать из состава/);
  assert.match(detail, /Добавить в корзину/);
  assert.match(drawer, /modifier_option_ids: line\.customization\.modifierOptionIds/);
  assert.match(drawer, /note: line\.customization\.note/);
  assert.match(schema, /modifier_option_ids/);
  assert.doesNotMatch(drawer, /unit_price:\s*getCartLineUnitPrice|line_total:/);
});

test("retired social network and protected admin contact do not enter public runtime", () => {
  const runtimeFiles = sourceFiles(join(root, "src")).filter((path) => /\.(?:ts|tsx|js|mjs)$/.test(path));
  for (const path of runtimeFiles) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /instagram(?:\.com|_url)?/i, path);
  }
  const settings = read("src/lib/settings.ts");
  assert.match(settings, /sanitizePublicContactPhone/);
  assert.match(settings, /process\.env\.ADMIN_PHONE/);
  assert.match(settings, /LEGAL_CONTACTS\.supportPhone/);
  assert.doesNotMatch(settings, /\.select\("\*"\)/);
});

test("admin remains available on the primary host and excluded from indexing", () => {
  const proxy = read("src/proxy.ts");
  const layout = read("src/app/admin/layout.tsx");
  const sitemap = read("src/app/sitemap.ts");
  const robots = read("src/app/robots.ts");
  assert.match(proxy, /pathname === "\/admin"/);
  assert.match(proxy, /X-Robots-Tag/);
  assert.match(layout, /index: false, follow: false/);
  assert.doesNotMatch(layout, /headers\(\)|notFound\(\)/);
  assert.doesNotMatch(sitemap, /\/admin/);
  assert.match(robots, /"\/admin\/"/);
});

test("Telegram, MAX, password, SMS, and safe return paths remain wired", () => {
  const authForm = read("src/components/auth/AuthForm.tsx");
  const socialButtons = read("src/components/auth/SocialAuthButtons.tsx");
  const telegramButton = read("src/components/auth/TelegramLoginButton.tsx");
  const maxButton = read("src/components/auth/MaxLoginButton.tsx");
  const authActions = read("src/app/auth/actions.ts");
  const telegramConsume = read("src/app/api/auth/social/telegram/consume/route.ts");
  const maxConsume = read("src/app/api/auth/social/max/consume/route.ts");
  assert.match(authForm, /SocialAuthButtons/);
  assert.match(socialButtons, /TelegramLoginButton/);
  assert.match(socialButtons, /MaxLoginButton/);
  assert.match(authActions, /loginWithPasswordAction/);
  assert.match(authActions, /requestLoginCodeAction/);
  assert.match(telegramButton, /returnTo/);
  assert.match(maxButton, /returnTo/);
  assert.match(telegramConsume, /claimCompletedTelegramAttempt/);
  assert.match(maxConsume, /claimCompletedMaxChallenge/);
  assert.match(maxConsume, /markMaxChallengeConsumed/);
});
