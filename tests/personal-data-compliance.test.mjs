import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("checkout uses contract processing notice and offer clickwrap without PD checkbox", () => {
  const action = read("src/app/actions/orders.ts");
  const drawer = read("src/components/cart/CartDrawer.tsx");
  const migration = read("database/migrations/20261008100000_correct_checkout_consent_basis.sql");
  assert.doesNotMatch(action, /personal_data_consent/);
  assert.match(drawer, /Данные используются для оформления и исполнения заказа/);
  assert.match(drawer, /Нажимая «Оформить заказ», вы принимаете условия/);
  assert.doesNotMatch(drawer, /name="offer_acceptance"/);
  assert.match(migration, /'offer_acceptance'/);
  assert.match(migration, /add column if not exists order_id uuid references public\.orders\(id\)/);
  assert.match(migration, /subject_id, order_id, consent_type/);
  assert.doesNotMatch(migration, /'personal_data'/);
  assert.doesNotMatch(migration, /if not p_personal_data_granted/i);
});

test("public pickup display receives only order number and status", () => {
  const page = read("src/app/display/page.tsx");
  const types = read("src/lib/order-flow/types.ts");
  const component = read("src/components/operations/PickupDisplay.tsx");
  assert.match(page, /displayNumber: order\.displayNumber/);
  assert.match(page, /kitchenStatus: order\.kitchenStatus/);
  assert.doesNotMatch(page, /publicDisplayName|publicAvatar|id: order\.id|customerPhone|customer_phone/);
  const publicType = types.slice(types.indexOf("export type PublicDisplayOrder"), types.indexOf("export type OrderFlowItem"));
  assert.doesNotMatch(publicType, /publicDisplayName|publicAvatar|\bid:/);
  assert.doesNotMatch(component, /GuestAvatar|publicDisplayName|publicAvatar/);
});

test("marketing choice is recorded only on explicit choice and reused by version", () => {
  const action = read("src/app/actions/orders.ts");
  const helper = read("src/lib/legal-consents.ts");
  const drawer = read("src/components/cart/CartDrawer.tsx");
  assert.match(action, /getCurrentConsentState\(customer\.id, "marketing"\)/);
  assert.match(action, /marketingChoiceMade/);
  assert.match(drawer, /!marketingChoiceMade/);
  assert.match(helper, /existing\?\.granted === consent\.granted && existing\.document_version === LEGAL_VERSION/);
  assert.match(helper, /granted_at: consent\.granted \? now : null/);
  assert.match(helper, /revoked_at: !consent\.granted && existing\?\.granted === true \? now : null/);
});

test("social authentication does not invent personal-data consent", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const actions = read("src/app/auth/actions.ts");
  assert.doesNotMatch(identity, /'personal_data'/);
  assert.doesNotMatch(actions, /type: "personal_data"/);
});

test("social claim storage is limited to the provider id and authentication signal", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const types = read("src/lib/auth/social/types.ts");
  const view = identity.slice(identity.indexOf("export type UserIdentityView"), identity.indexOf("export type SocialCompletionAttempt"));
  const migration = read("database/migrations/20261008120000_minimize_social_identity_data.sql");
  assert.match(identity, /provider_user_id, phone_verified, linked_at, last_login_at/);
  assert.match(identity, /set username = null,[\s\S]+email = null,[\s\S]+metadata = excluded\.metadata/);
  assert.match(identity, /select\("id, provider, phone_verified, linked_at, last_login_at"\)/);
  assert.doesNotMatch(types, /username:|avatarUrl:|email:|metadata:/);
  assert.match(types, /telegramBotUserId\?: string \| null/);
  assert.match(identity, /telegramBotUserId: z\.string\(\)\.regex/);
  assert.doesNotMatch(view, /providerUserId/);
  assert.match(migration, /where provider in \('telegram', 'max'\)/);
});

test("loyalty membership requires a versioned one-time opt-in", () => {
  const profileData = read("src/lib/customer-data.ts");
  const loyaltyPage = read("src/app/profile/loyalty/page.tsx");
  const membershipAction = read("src/app/profile/loyalty/actions.ts");
  const wallet = read("src/app/api/loyalty/card/qr/route.ts");
  assert.match(profileData, /getLoyaltyAccount\(customer\.id\)/);
  assert.doesNotMatch(profileData, /ensureLoyaltyAccount/);
  assert.match(loyaltyPage, /consent\.document_version !== LEGAL_VERSION/);
  assert.match(loyaltyPage, /Присоединиться и принять правила/);
  assert.match(membershipAction, /type: "loyalty_rules", granted: true/);
  assert.match(wallet, /consent\?\.granted !== true/);
});

test("cookie evidence failure leaves banner visible and optional categories disabled", () => {
  const banner = read("src/components/CookieConsentBanner.tsx");
  const route = read("src/app/api/cookie-consent/route.ts");
  assert.match(banner, /result\.ok !== true \|\| result\.stored !== true/);
  assert.match(banner, /setSaveError\("Не удалось сохранить выбор/);
  assert.match(route, /stored: false/);
  assert.match(route, /await sql\.begin/);
  assert.match(route, /document_version: string/);
  assert.match(route, /current\[0\]\?\.granted === true/);
});

test("OTP is never written to verification logs", () => {
  const sender = read("src/lib/verification/send-code.ts");
  assert.doesNotMatch(sender, /console\.(info|log|warn|error)/);
  assert.doesNotMatch(sender, /\$\{phone\}|\$\{code/);
});

test("general lead is a response request; franchise and careers use their matching consent", () => {
  const form = read("src/components/LeadForm.tsx");
  const action = read("src/app/actions/leads.ts");
  assert.match(form, /selectedInterest === "career" \|\| selectedInterest === "franchise"/);
  assert.match(form, /\/legal\/careers-consent/);
  assert.match(form, /\/legal\/franchise-consent/);
  assert.match(action, /interest === "career" \|\| parsed\.data\.interest === "franchise"/);
  assert.match(action, /isChecked\(formData\.get\("marketing_consent"\)\)/);
  assert.match(action, /rpc\("create_lead_with_consents_atomic"/);
  assert.doesNotMatch(action, /\.from\("leads"\)[\s\S]+recordLegalConsents/);
  const migration = read("database/migrations/20261008100000_correct_checkout_consent_basis.sql");
  assert.match(migration, /create or replace function public\.create_lead_with_consents_atomic/);
});

test("manual deletion is dry-run first and explicitly preserves finance records", () => {
  const deletion = read("scripts/delete-customer-personal-data.mjs");
  assert.match(deletion, /PERSONAL_DATA_DELETE_DATABASE_URL/);
  assert.doesNotMatch(deletion, /process\.env\.DATABASE_URL/);
  assert.match(deletion, /--confirm-customer-id/);
  assert.match(deletion, /'privacy_request', \$\{requestId\}/);
  assert.doesNotMatch(deletion, /entity_id = \$\{customerId\}/);
  assert.match(deletion, /--execute/);
  assert.match(deletion, /update public\.app_sessions set revoked_at/);
  assert.match(deletion, /update public\.customers set birthday = null/);
  assert.match(deletion, /financial_records_preserved: true/);
  assert.doesNotMatch(deletion, /delete from public\.(orders|payments|fiscal_receipts|refunds)/);
});
