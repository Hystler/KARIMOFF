import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compare, hash } from "bcryptjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function importTypescriptScript(modulePath, body) {
  const moduleUrl = pathToFileURL(join(root, modulePath)).href;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", `const subject = await import(${JSON.stringify(moduleUrl)});\n${body}`],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("Telegram RS256 ID token validates signature, issuer, audience, expiry and nonce", () => {
  const output = importTypescriptScript("src/lib/auth/social/telegram-token.ts", `
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256" };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = 2_000_000_000;
    const make = (claims, signingKey = privateKey) => {
      const header = encode({ alg: "RS256", kid: "test-key", typ: "JWT" });
      const payload = encode({ iss: "https://oauth.telegram.org", aud: "12345", sub: "tg-user", iat: now - 10, exp: now + 300, nonce: "nonce-value", ...claims });
      const input = header + "." + payload;
      return input + "." + sign("RSA-SHA256", Buffer.from(input), signingKey).toString("base64url");
    };
    const valid = subject.verifyTelegramIdToken({ token: make({}), keys: [key], expectedAudience: "12345", expectedNonce: "nonce-value", nowSeconds: now });
    const checks = [
      () => subject.verifyTelegramIdToken({ token: make({}), keys: [key], expectedAudience: "wrong", expectedNonce: "nonce-value", nowSeconds: now }),
      () => subject.verifyTelegramIdToken({ token: make({}), keys: [key], expectedAudience: "12345", expectedNonce: "wrong", nowSeconds: now }),
      () => subject.verifyTelegramIdToken({ token: make({ exp: now - 1 }), keys: [key], expectedAudience: "12345", expectedNonce: "nonce-value", nowSeconds: now }),
      () => { const parts = make({}).split("."); parts[1] = encode({ iss: "https://oauth.telegram.org", aud: "12345", sub: "other", iat: now - 10, exp: now + 300, nonce: "nonce-value" }); return subject.verifyTelegramIdToken({ token: parts.join("."), keys: [key], expectedAudience: "12345", expectedNonce: "nonce-value", nowSeconds: now }); }
    ];
    console.log(JSON.stringify({ sub: valid.sub, rejected: checks.map((check) => { try { check(); return false; } catch { return true; } }) }));
  `);
  const result = JSON.parse(output);
  assert.equal(result.sub, "tg-user");
  assert.deepEqual(result.rejected, [true, true, true, true]);
});

test("linking rules never use names and require a verified provider phone for automatic merge", () => {
  const output = importTypescriptScript("src/lib/auth/social/linking-rules.ts", `
    console.log(JSON.stringify([
      subject.resolveSocialLoginTarget({ existingIdentityUserId: "u1", providerPhoneVerified: false, verifiedPhoneUserId: null }),
      subject.resolveSocialLoginTarget({ existingIdentityUserId: null, providerPhoneVerified: true, verifiedPhoneUserId: "u2" }),
      subject.resolveSocialLoginTarget({ existingIdentityUserId: null, providerPhoneVerified: false, verifiedPhoneUserId: "u2" }),
      subject.resolveSocialLoginTarget({ existingIdentityUserId: null, providerPhoneVerified: true, verifiedPhoneUserId: null }),
      subject.resolveVerifiedSocialIdentity({
        existingIdentityUserId: null,
        providerPhone: "+79991234567",
        providerPhoneVerified: true,
        phoneOwner: { userId: "legacy-user", verified: false }
      })
    ]));
  `);
  const [existing, verified, unverified, missing, legacy] = JSON.parse(output);
  assert.deepEqual(existing, { kind: "existing_identity", userId: "u1" });
  assert.deepEqual(verified, { kind: "verified_phone", userId: "u2" });
  assert.equal(unverified.kind, "needs_phone_confirmation");
  assert.equal(missing.kind, "needs_phone_confirmation");
  assert.deepEqual(legacy, { kind: "verified_phone", userId: "legacy-user" });
  assert.doesNotMatch(read("src/lib/auth/social/identity.ts"), /find.*display.?name|where display_name/i);
});

test("the last authentication method cannot be unlinked", () => {
  const output = importTypescriptScript("src/lib/auth/social/linking-rules.ts", `
    console.log(JSON.stringify([
      subject.canUnlinkAuthenticationMethod(1, false),
      subject.canUnlinkAuthenticationMethod(2, false),
      subject.canUnlinkAuthenticationMethod(1, true)
    ]));
  `);
  assert.deepEqual(JSON.parse(output), [false, true, true]);
  assert.match(read("src/app/profile/actions.ts"), /canUnlinkAuthenticationMethod/);
});

test("OAuth state is server-authoritative, one-time and expires", () => {
  const state = read("src/lib/auth/social/state.ts");
  const migration = read("supabase/migrations/20260824120000_add_telegram_browser_consume.sql");
  assert.match(state, /randomBase64Url\(32\)/);
  assert.match(state, /state_hash[\s\S]*hashOAuthSecret\(browserBinding\)/);
  assert.match(state, /requireTelegramBrowserBinding/);
  assert.match(state, /status = 'provider_verified'/);
  assert.match(state, /status = 'completed'/);
  assert.match(state, /browser_consumed_at = coalesce\(browser_consumed_at, now\(\)\)/);
  assert.match(state, /expires_at > now\(\)/);
  assert.match(state, /encryptOAuthSecret\(randomBase64Url\(48\)\)/);
  assert.match(state, /httpOnly: true/);
  assert.match(state, /sameSite: "lax"/);
  assert.match(state, /path: "\/"/);
  assert.match(migration, /identity_ciphertext/);
  assert.match(migration, /browser_consumed_at/);
  assert.match(migration, /status in \('pending', 'provider_verified', 'completed', 'failed'\)/);
  const customerSession = read("src/lib/customer-auth.ts");
  assert.match(customerSession, /sameSite: "lax"/);
  assert.match(customerSession, /path: "\/"/);
  assert.doesNotMatch(customerSession, /domain:/);
});

test("social redirects preserve the external reverse-proxy origin", () => {
  const output = importTypescriptScript("src/lib/request-security.ts", `
    const request = new Request("https://0.0.0.0:3000/api/auth/social/telegram/start", {
      headers: {
        host: "0.0.0.0:3000",
        "x-forwarded-host": "hystler-karimoff-stand-ad9d.twc1.net",
        "x-forwarded-proto": "https"
      }
    });
    console.log(subject.getPublicRequestUrl(request, "/login?socialError=unavailable").toString());
  `);
  assert.equal(output, "https://hystler-karimoff-stand-ad9d.twc1.net/login?socialError=unavailable");

  const routes = `${read("src/app/api/auth/social/telegram/library/start/route.ts")}\n${read("src/app/api/auth/social/max/status/route.ts")}`;
  assert.doesNotMatch(routes, /new URL\([^\n]+request\.url/);
  assert.match(routes, /sanitizeSocialRedirect|returnTo/);
});

test("configured app origin wins when a reverse proxy hides the public host", () => {
  const output = importTypescriptScript("src/lib/request-security.ts", `
    process.env.APP_ORIGIN = "https://hystler-karimoff-stand-ad9d.twc1.net";
    const request = new Request("https://0.0.0.0:3000/api/auth/social/telegram/start", {
      headers: { host: "0.0.0.0:3000" }
    });
    console.log(subject.getPublicRequestUrl(request, "/login?socialError=unavailable").toString());
  `);
  assert.equal(output, "https://hystler-karimoff-stand-ad9d.twc1.net/login?socialError=unavailable");
  assert.match(read(".env.example"), /^APP_ORIGIN=https:\/\//m);
});

test("VK runtime is retired without destructively removing historical identities", () => {
  const migration = read("supabase/migrations/20260820190000_add_max_social_auth.sql");
  const env = read(".env.example");
  const socialButtons = read("src/components/auth/SocialAuthButtons.tsx");
  assert.equal(existsSync(join(root, "src/lib/auth/social/vk.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/start/route.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/callback/route.ts")), false);
  assert.doesNotMatch(env, /^VK_/m);
  assert.doesNotMatch(socialButtons, /enabled\.vk|provider="vk"/);
  assert.match(migration, /'phone', 'telegram', 'vk', 'max'/);
});

test("identity schema prevents duplicate provider identities and denies public access", () => {
  const migration = read("supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql");
  assert.match(migration, /unique \(provider, provider_user_id\)/);
  assert.match(migration, /unique \(user_id, provider\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.user_identities from public/);
  assert.match(migration, /to karimoff_app/);
  assert.match(read("src/app/api/auth/avatar/route.ts"), /\["owner", "admin", "manager"\]/);
});

test("admin credentials are bcrypt-only and no default plaintext password remains", async () => {
  const password = "test-only-random-password";
  const digest = await hash(password, 12);
  assert.equal(await compare(password, digest), true);
  const adminAuth = read("src/lib/admin-auth.ts");
  const envExample = read(".env.example");
  assert.match(adminAuth, /ADMIN_PASSWORD_HASH/);
  assert.doesNotMatch(adminAuth, /process\.env\.ADMIN_PASSWORD(?:[^_]|$)/);
  assert.doesNotMatch(envExample, /^ADMIN_PASSWORD=/m);
  assert.doesNotMatch(`${adminAuth}\n${envExample}`, /1111|change_me/);
  assert.match(read("src/lib/password-auth.ts"), /PASSWORD_BCRYPT_COST = 12/);
});

test("admin rate limiting has exponential temporary lockout and session rotation", () => {
  const migration = read("supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql");
  const adminAuth = read("src/lib/admin-auth.ts");
  assert.match(migration, /v_lock_multiplier/);
  assert.match(migration, /least\(86400/);
  assert.match(adminAuth, /await revokeCurrentSession\(\)/);
  assert.match(adminAuth, /httpOnly: true/);
  assert.match(adminAuth, /sameSite: "strict"/);
  assert.match(adminAuth, /secure: process\.env\.NODE_ENV === "production"/);
});

test("owner TOTP validates RFC 6238 codes but remains disabled pending recovery support", () => {
  const output = importTypescriptScript("src/lib/totp.ts", `
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    console.log(JSON.stringify({
      knownVector: subject.verifyTotpCode({ secret, code: "287082", nowMs: 59_000 }),
      adjacentWindow: subject.verifyTotpCode({ secret, code: "287082", nowMs: 89_000 }),
      wrongCode: subject.verifyTotpCode({ secret, code: "287083", nowMs: 59_000 }),
      malformed: subject.verifyTotpCode({ secret, code: "28 7082", nowMs: 59_000 })
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    knownVector: true,
    adjacentWindow: true,
    wrongCode: false,
    malformed: false
  });
  const adminAuth = read("src/lib/admin-auth.ts");
  const loginPage = read("src/app/admin/login/page.tsx");
  const loginAction = read("src/app/admin/login/actions.ts");
  const securityDocs = read("docs/security-auth-social.md");
  assert.match(adminAuth, /ADMIN_TOTP_SECRET/);
  assert.match(loginPage, /isAdminTotpConfigured/);
  assert.match(loginAction, /checkAuthRateLimit\("admin_login"/);
  assert.match(loginAction, /recordAuthFailure\("admin_login"/);
  assert.match(securityDocs, /Keep `ADMIN_TOTP_SECRET` unset/);
});

test("404 is brand-safe, responsive and respects reduced motion", () => {
  const page = read("src/app/not-found.tsx");
  const css = read("src/app/globals.css");
  assert.match(page, /Заказ №404/);
  assert.match(page, /Похоже, его уже забрали/);
  assert.match(page, /aria-label="Заказ №404 не найден"/);
  assert.match(page, /В меню/);
  assert.match(page, /На главную/);
  assert.doesNotMatch(page, /бургер|панда|маскот/i);
  assert.match(page, /sm:text-\[138px\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /not-found-ticker-track/);
});
