# Profile / Avatar Theme Audit

## Scope And Root Causes

- The avatar form and sticky footer had hard-coded light backgrounds while global dark-mode utilities forced their text to white. Translucent unselected options inherited that unreadable combination.
- Small orange text, primary-action labels, dark-mode status messages, and compact provider controls needed explicit foreground/background pairs rather than inherited utility colors.
- The editor escaped its container with `100vw` and a transform, which can include the desktop scrollbar. The page now places the editor outside the constrained heading container and uses normal full-width flow.
- Long profile names and editor labels could squeeze the avatar or controls. The preview no longer shrinks, text wraps, narrow section controls stack their icon and label, and selected-option captions reserve their height.
- The preview wordmark used white text over translucent white, including on the white scene. Its overlay now has a consistently dark background. SVG artwork and all 3D models/materials/camera logic are unchanged.

## Changed Files

- `src/app/profile/page.tsx`: scoped semantic classes and narrow-screen layout; provider wrappers and order-preview scope only, no handler/data changes.
- `src/app/profile/avatar/page.tsx`: stylesheet import and full-width editor placement.
- `src/components/avatar/AvatarBuilder.tsx`: themed controls, pressed state, stable option heights, preserved inline swatch colors.
- `src/components/avatar/AvatarPreview.tsx`: fixed preview size and readable wordmark only.
- `src/app/profile/profile-theme.css`: new `.profile-theme`-scoped tokens/styles, no `!important`.
- `src/app/profile/profile-theme.test.mjs`: seven focused contrast/scope checks.
- `src/app/profile/PROFILE_THEME_AUDIT.md`: this handoff and local-session recipe.

No changes to globals, theme provider, actions, auth, DB, environment files, menu, products, cart, or nutrition. Concurrent changes elsewhere in the working tree belong to other work. No commit or deployment.

## Verification

Passed:

```sh
npm run typecheck -- --incremental false
npx --no-install eslint src/components/avatar src/app/profile
node --test src/app/profile/profile-theme.test.mjs tests/avatar-studio.test.mjs tests/login-menu-theme-ux.test.mjs tests/customer-orders-cart-notifications.test.mjs
git diff --check -- src/components/avatar src/app/profile
```

The combined focused run passes 19 tests. The new co-located tests must be included explicitly; `npm test` only discovers `tests/*.test.mjs`.

An isolated headless browser rendered the actual profile/avatar components with in-memory synthetic data, mocked auth/data/action imports and all network requests blocked. No browser cookies, real login, DB calls, provider calls, or saved user data were involved.

- Light and dark, at widths 320 / 390 / 768 / 1024 / 1440: no document or checked text/control overflow; profile preview remains 160px wide.
- Actual rendered text samples on both pages meet their 4.5:1 normal-text / 3:1 large-text thresholds. Token tests also cover error, success, hover, selection, focus accents, and provider colors.
- Background swatches preserve their four exact palette values in both themes; selecting/resetting leaves option heights stable.
- Shuffle, reset, and all six submitted avatar fields work against an inert fixture save action.
- The unchanged 3D canvas is nonblank and animated; pause and camera-reset controls respond. No page exceptions.

Limitations: fixture fonts used Arial in place of Next's loaded webfont; no production build, real authenticated route/DB round-trip, or real provider flow was run. The main task should verify the complete local app with its actual fonts/chrome and fixture session below.

## Local PG Session Recipe (Not Executed)

Prefer a separate, already-migrated disposable PostgreSQL database and an isolated browser context. Point a separate local app process at that database, with the same test-only `SESSION_SECRET` as the harness. Do not load production secrets or use the user's existing browser profile. Keep payment, notification, and integration workers disabled and provider credentials empty; intercept any provider network/auto-resume requests if testing configured provider buttons.

The app uses the direct PostgreSQL adapter, not Supabase Auth/JWT. See `src/lib/customer-auth.ts`: `setCustomerSession()` stores a random base64url token in cookie `karimoff_customer_session` and its HMAC-SHA256 hex digest in `public.app_sessions.token_hash`. `getCustomerSession()` requires `subject_type='customer'`, a matching `subject_id`, `revoked_at IS NULL`, and a future `expires_at`. No password, OTP, provider identity, or user-agent binding is required to read these routes.

Schema references:

- `supabase/migrations/202607070001_karimoff_baseline_schema.sql`: customers (line 126), loyalty accounts/transactions (435/444), customer avatars (496), avatar assets.
- `supabase/migrations/20260724110535_harden_mvp_security_and_legal.sql`: legal consents (35), app sessions (57).
- `supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql`: user identities. Use the current migrated schema for subsequent MAX/ordering fields.

Use the current complete fixture schema: `/profile` also queries orders, loyalty transactions, legal consents, identities, and the shared site chrome/settings. Empty tables are sufficient for empty states. `/profile/avatar` needs `avatar_assets` present; an empty assets table falls back to the built-in choices.

Important: opening `/profile` calls `ensureLoyaltyAccount()` and attempts an upsert. It is not a strictly read-only DB route. Avatar saving also writes to `customer_avatars`. Use only the disposable database.

In an existing Node/Playwright fixture harness, where `context` is a new isolated browser context and the local app is already running:

```js
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const origin = "http://127.0.0.1:3116";
const secret = "profile-theme-testsecret-local-only-2026";
// The local app must have the same SESSION_SECRET and DATABASE_URL.
const databaseUrl = process.env.PROFILE_FIXTURE_DATABASE_URL;
const parsed = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
assert.equal(parsed.pathname, "/karimoff_profile_fixture");
const sql = postgres(databaseUrl, { max: 1 });
const customerId = randomUUID();
const token = randomBytes(32).toString("base64url");
const tokenHash = createHmac("sha256", secret).update(token).digest("hex");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

try {
  await sql.begin(async (tx) => {
    await tx`insert into public.customers (id, name, phone)
      values (${customerId}, 'Profile fixture with a long test name', '+70000000001')`;
    await tx`insert into public.loyalty_accounts (customer_id, points_balance, total_earned)
      values (${customerId}, 1234.5, 5678.9)`;
    await tx`insert into public.customer_avatars
      (customer_id, base, eyes, mouth, accessory, clothes, background)
      values (${customerId}, 'panda_core', 'bright', 'smile', 'none', 'varsity_orange', 'studio_orange')`;
    await tx`insert into public.app_sessions
      (subject_type, subject_id, token_hash, expires_at, revoked_at)
      values ('customer', ${customerId}, ${tokenHash}, ${expiresAt.toISOString()}, null)`;
  });

  await context.addCookies([{
    name: "karimoff_customer_session", value: token,
    domain: "127.0.0.1", path: "/", httpOnly: true,
    sameSite: "Lax", secure: false,
    expires: Math.floor(expiresAt.getTime() / 1000)
  }]);
  await context.addInitScript(() => {
    localStorage.setItem("karimoff_theme_preference_v2", "dark");
  });
  const page = await context.newPage();
  await page.goto(`${origin}/profile`);
  assert.equal(new URL(page.url()).pathname, "/profile");
  // Verify /profile, /profile/avatar, themes, viewport sizes and local save.
} finally {
  await context.close();
  await sql`delete from public.app_sessions where token_hash = ${tokenHash}`;
  await sql`delete from public.legal_consents
    where subject_type = 'customer' and subject_id = ${customerId}`;
  await sql`delete from public.customers where id = ${customerId}`;
  await sql.end();
}
```

For another viewport/theme, create a new context and set the preference before navigating. Use `secure: true` for a local HTTPS origin. The app's normal production session helper sets `secure: true`; the example deliberately installs an HTTP-local-only fixture cookie without invoking that helper.

Do not call `setCustomerSession()` from a test route or add an auth bypass to application code. Seed the fixture session in the harness, and close/delete only that harness's browser context and rows afterward.
