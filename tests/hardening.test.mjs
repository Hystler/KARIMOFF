import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260724110535_harden_mvp_security_and_legal.sql");
const orderAction = read("src/app/actions/orders.ts");
const orderSchema = read("src/lib/order-schema.ts");
const cartDrawer = read("src/components/cart/CartDrawer.tsx");
const authForm = read("src/components/auth/AuthForm.tsx");
const leadAction = read("src/app/actions/leads.ts");
const cookieBanner = read("src/components/CookieConsentBanner.tsx");
const cookieRoute = read("src/app/api/cookie-consent/route.ts");
const profileAction = read("src/app/profile/actions.ts");
const smsSender = read("src/lib/verification/send-code.ts");

test("browser order payload cannot supply a trusted price", () => {
  assert.doesNotMatch(orderSchema, /\bprice\s*:/);
  assert.match(cartDrawer, /product_id: line\.product\.id/);
  assert.match(cartDrawer, /quantity: line\.quantity/);
  assert.doesNotMatch(cartDrawer, /p_(unit_)?price|trusted_price/);
  assert.match(migration, /join public\.products p on p\.id = r\.product_id and p\.is_active = true/);
  assert.match(migration, /p\.price \* r\.quantity/);
  assert.doesNotMatch(orderAction, /\.from\(["']orders["']\)\.insert/);
});

test("completed orders are serialized and cannot deduct inventory twice", () => {
  assert.match(migration, /from public\.orders[\s\S]+for update/);
  assert.match(migration, /v_inventory_already_deducted boolean := false/);
  assert.match(migration, /from public\.order_inventory_deductions oid[\s\S]+where oid\.order_id = p_order_id/);
  assert.match(migration, /if not v_inventory_already_deducted then/);
  assert.match(migration, /insert into public\.order_inventory_deductions \(order_id, status\)/);
});

test("inventory rows are locked and negative balances are rejected", () => {
  assert.match(migration, /from public\.inventory_items ii[\s\S]+order by ii\.ingredient_id[\s\S]+for update/);
  assert.match(migration, /where coalesce\(ii\.current_quantity, 0\) < r\.required_quantity/);
  assert.match(migration, /check \(current_quantity >= 0 and reserved_quantity >= 0 and min_quantity >= 0\)/);
});

test("personal-data consent is mandatory and marketing remains optional", () => {
  assert.match(orderAction, /if \(!isChecked\(formData\.get\("personal_data_consent"\)\)\)/);
  assert.match(orderAction, /p_marketing_granted: isChecked\(formData\.get\("marketing_consent"\)\)/);
  assert.match(leadAction, /if \(!isChecked\(formData\.get\("personal_data_consent"\)\)\)/);
  assert.match(authForm, /const \[marketingConsent, setMarketingConsent\] = useState\(false\)/);
  assert.doesNotMatch(authForm, /name="marketing_consent"[\s\S]{0,120}defaultChecked/);
});

test("cookie categories are disabled until consent and revocation is journaled", () => {
  assert.match(cookieBanner, /const \[analytics, setAnalytics\] = useState\(false\)/);
  assert.match(cookieBanner, /const \[marketing, setMarketing\] = useState\(false\)/);
  assert.match(cookieRoute, /\{ type: "cookies_analytics", granted: categories\.analytics \}/);
  assert.match(cookieRoute, /\{ type: "cookies_marketing", granted: categories\.marketing \}/);
  assert.doesNotMatch(cookieBanner, /google-analytics|googletagmanager|metrika|facebook\.net/i);
});

test("marketing withdrawal is stored without disabling the account", () => {
  assert.match(profileAction, /consents: \[\{ type: "marketing", granted \}\]/);
  assert.match(profileAction, /consent\.marketing_revoked/);
  assert.doesNotMatch(profileAction, /customers["']\)\.delete|clearCustomerSession\(\)[\s\S]+marketing/);
});

test("anon and authenticated roles are denied internal data access", () => {
  assert.match(migration, /revoke all privileges on table public\.%I from anon, authenticated/);
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /create policy products_public_read/);
  assert.doesNotMatch(migration, /inventory_items_public|economics_settings_public/);
});

test("production mock SMS fails closed", () => {
  assert.match(smsSender, /if \(process\.env\.NODE_ENV !== "production"\)/);
  assert.match(smsSender, /No real provider adapter is implemented/);
  assert.match(smsSender, /return \{ ok: false \};\s*\n\}/);
});

test("real payments remain disabled by default", () => {
  assert.match(migration, /payments_enabled boolean default false/);
  assert.match(migration, /set loyalty_percent = 10, payments_enabled = false/);
});
