import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("loyalty card QR is signed, private, rotatable, and cannot authorize redemption", () => {
  const service = read("src/lib/loyalty-card.ts");
  const qrRoute = read("src/app/api/loyalty/card/qr/route.ts");
  const profile = read("src/app/profile/loyalty/page.tsx");

  assert.match(service, /createHmac\("sha256", sessionSecret\)\.update\("karimoff:loyalty-card:l1"\)/);
  assert.match(service, /timingSafeEqual/);
  assert.match(service, /token_version = token_version \+ 1/);
  assert.match(service, /card\.token_version = \$\{parsed\.tokenVersion\}/);
  assert.match(qrRoute, /QRCode\.toString\(createLoyaltyCardToken\(card\)/);
  assert.doesNotMatch(qrRoute, /points_balance|customer\.phone/);
  assert.match(qrRoute, /private, no-store/);
  assert.match(profile, /QR не содержит телефон и не позволяет списать баллы/);
});

test("loyalty migration is additive, RLS-protected, and preserves the old POS RPC", () => {
  const migration = read("supabase/migrations/20260901170000_add_loyalty_cards_and_audience.sql");
  const runtime = read("scripts/apply-runtime-schema-migrations.mjs");
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");

  assert.match(migration, /create table if not exists public\.loyalty_cards/);
  assert.match(migration, /unique \(customer_id\)/);
  assert.match(migration, /unique \(public_code\)/);
  assert.match(migration, /alter table public\.loyalty_cards enable row level security/);
  assert.match(migration, /create policy loyalty_cards_app_all/);
  assert.match(migration, /create or replace function public\.create_pos_order_atomic\([\s\S]+p_customer_id uuid/);
  assert.match(migration, /from public\.create_pos_order_atomic\([\s\S]+p_is_test/);
  assert.doesNotMatch(migration, /drop table|delete from public\.customers|truncate/i);
  assert.match(runtime, /20260901170000_add_loyalty_cards_and_audience/);
  assert.match(dockerfile, /20260901170000_add_loyalty_cards_and_audience\.sql/);
  assert.match(dockerignore, /20260901170000_add_loyalty_cards_and_audience\.sql/);
});

test("POS resolves cards server-side and attaches a customer to the canonical order", () => {
  const route = read("src/app/api/admin/loyalty/card/resolve/route.ts");
  const pos = read("src/components/operations/PosWorkspace.tsx");
  const identifier = read("src/components/operations/PosLoyaltyIdentifier.tsx");
  const action = read("src/app/pos/actions.ts");
  const order = read("src/lib/order-flow/service.ts");

  assert.match(route, /getCurrentStaff/);
  assert.match(route, /isAllowedSameOriginRequest/);
  assert.match(route, /phoneMasked/);
  assert.doesNotMatch(route, /phone: resolved\.customer\.phone/);
  assert.match(pos, /PosLoyaltyIdentifier/);
  assert.match(pos, /name="customer_id"/);
  assert.match(identifier, /import\("@zxing\/browser"\)/);
  assert.match(identifier, /facingMode: \{ ideal: "environment" \}/);
  assert.match(identifier, /Камера используется только для чтения QR/);
  assert.match(action, /customerId: z\.union/);
  assert.match(order, /p_customer_id: input\.customerId/);
});

test("Wallet integrations are official-format, server-only, and hidden until configured", () => {
  const config = read("src/lib/wallet/config.ts");
  const apple = read("src/lib/wallet/apple.ts");
  const google = read("src/lib/wallet/google.ts");
  const profile = read("src/app/profile/loyalty/page.tsx");
  const env = read(".env.example");

  assert.match(config, /import "server-only"/);
  assert.match(apple, /PKBarcodeFormatQR/);
  assert.match(apple, /passTypeIdentifier/);
  assert.match(google, /alg: "RS256"/);
  assert.match(google, /https:\/\/pay\.google\.com\/gp\/v\/save\//);
  assert.match(profile, /wallet\.apple \|\| wallet\.google/);
  assert.doesNotMatch(apple + google, /NEXT_PUBLIC_/);
  assert.match(env, /APPLE_WALLET_PASS_TYPE_ID=/);
  assert.match(env, /GOOGLE_WALLET_ISSUER_ID=/);
});

test("audience analytics uses identified canonical sales and suppresses invented demographics", () => {
  const audience = read("src/lib/analytics/audience.ts");
  const page = read("src/app/admin/analytics/audience/page.tsx");
  const component = read("src/components/admin/analytics/AudienceAnalytics.tsx");
  const subnav = read("src/components/admin/analytics/AnalyticsSubnav.tsx");

  assert.match(audience, /public\.canonical_analytics_sales/);
  assert.match(audience, /s\.customer_id is not null/);
  assert.match(audience, /"loyal"|loyal:/);
  assert.match(audience, /"at_risk"|at_risk:/);
  assert.match(audience, /ages\.length < 10/);
  assert.match(audience, /row\.customers < 3/);
  assert.match(component, /Предполагаемые пол, интересы и доход здесь не используются/);
  assert.match(component, /Пол и доход KARIMOFF не собирает/);
  assert.match(page, /getAnalyticsScope/);
  assert.match(subnav, /\/admin\/analytics\/audience/);
});
