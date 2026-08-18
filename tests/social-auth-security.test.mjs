import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      subject.resolveSocialLoginTarget({ existingIdentityUserId: null, providerPhoneVerified: true, verifiedPhoneUserId: null })
    ]));
  `);
  const [existing, verified, unverified, missing] = JSON.parse(output);
  assert.deepEqual(existing, { kind: "existing_identity", userId: "u1" });
  assert.deepEqual(verified, { kind: "verified_phone", userId: "u2" });
  assert.equal(unverified.kind, "needs_phone_confirmation");
  assert.equal(missing.kind, "needs_phone_confirmation");
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

test("OAuth state is browser-bound, one-time and expires", () => {
  const state = read("src/lib/auth/social/state.ts");
  assert.match(state, /safeSecretEqual\(cookieState, returnedState\)/);
  assert.match(state, /set consumed_at = now\(\)/);
  assert.match(state, /consumed_at is null/);
  assert.match(state, /expires_at > now\(\)/);
  assert.match(state, /encryptOAuthSecret\(codeVerifier\)/);
  assert.match(state, /httpOnly: true/);
  assert.match(state, /sameSite: "lax"/);
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

  const routes = `${read("src/app/api/auth/social/[provider]/start/route.ts")}\n${read("src/app/api/auth/social/[provider]/callback/route.ts")}`;
  assert.doesNotMatch(routes, /new URL\([^\n]+request\.url/);
  assert.match(routes, /getPublicRequestUrl/);
});

test("VK ID uses OAuth 2.1 code flow with state and PKCE, without persisting tokens", () => {
  const vk = read("src/lib/auth/social/vk.ts");
  const migration = read("supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql");
  assert.match(vk, /response_type: "code"/);
  assert.match(vk, /code_challenge: params\.codeChallenge/);
  assert.match(vk, /code_challenge_method: "s256"/);
  assert.match(vk, /state: params\.state/);
  assert.match(vk, /code_verifier: params\.codeVerifier/);
  assert.match(vk, /phoneVerified: false/);
  assert.doesNotMatch(migration, /access_token|refresh_token/);
  assert.doesNotMatch(read(".env.example"), /VK_ID_CLIENT_SECRET/);
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

test("404 is brand-safe, responsive and respects reduced motion", () => {
  const page = read("src/app/not-found.tsx");
  const css = read("src/app/globals.css");
  assert.match(page, /Заказ №404/);
  assert.match(page, /Похоже, его уже забрали/);
  assert.match(page, /В меню/);
  assert.match(page, /На главную/);
  assert.doesNotMatch(page, /бургер|панда|маскот/i);
  assert.match(page, /sm:text-\[138px\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /not-found-ticker-track/);
});
