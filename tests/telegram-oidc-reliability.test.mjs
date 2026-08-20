import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

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

test("OAuth attempt failures distinguish missing, expired and replayed attempts", () => {
  const output = importTypescriptScript("src/lib/auth/social/state-policy.ts", `
    const now = Date.parse("2026-08-19T09:00:00.000Z");
    console.log(JSON.stringify([
      subject.classifyOAuthAttemptFailure({ exists: false, consumedAt: null, expiresAt: null, nowMs: now }).code,
      subject.classifyOAuthAttemptFailure({ exists: true, consumedAt: "2026-08-19T08:59:00.000Z", expiresAt: "2026-08-19T09:10:00.000Z", nowMs: now }).code,
      subject.classifyOAuthAttemptFailure({ exists: true, consumedAt: null, expiresAt: "2026-08-19T08:59:00.000Z", nowMs: now }).code
    ]));
  `);
  assert.deepEqual(JSON.parse(output), ["state_not_found", "state_replay", "expired_state"]);

  const state = read("src/lib/auth/social/state.ts");
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  assert.match(state, /set consumed_at = now\(\)/);
  assert.match(state, /consumed_at is null/);
  assert.match(state, /expires_at > now\(\)/);
  assert.match(complete, /requireBrowserBinding: true/);
});

test("Telegram phone normalization accepts Russian E.164 with and without plus", () => {
  const output = importTypescriptScript("src/lib/auth/social/telegram-protocol.ts", `
    console.log(JSON.stringify([
      subject.normalizeTelegramPhone("+79991234567"),
      subject.normalizeTelegramPhone("79991234567"),
      subject.normalizeTelegramPhone("89991234567"),
      subject.normalizeTelegramPhone("9991234567"),
      subject.normalizeTelegramPhone("+441234567890")
    ]));
  `);
  assert.deepEqual(JSON.parse(output), ["+79991234567", "+79991234567", "+79991234567", "+79991234567", null]);
});

test("Telegram library ID token accepts valid claims and rejects signature, issuer, audience, expiry and nonce failures", () => {
  const output = importTypescriptScript("src/lib/auth/social/telegram-token.ts", `
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const primary = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { ...primary.publicKey.export({ format: "jwk" }), kid: "telegram-key", alg: "RS256", use: "sig" };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = 2_000_000_000;
    const make = (overrides = {}, signingKey = primary.privateKey) => {
      const header = encode({ alg: "RS256", kid: "telegram-key", typ: "JWT" });
      const payload = encode({
        iss: "https://oauth.telegram.org", aud: "telegram-client", sub: "123456789",
        iat: now - 5, exp: now + 300, nonce: "expected-nonce", name: "Telegram User",
        preferred_username: "telegram_user", phone_number: "+79991234567",
        phone_number_verified: true, ...overrides
      });
      const input = header + "." + payload;
      return input + "." + sign("RSA-SHA256", Buffer.from(input), signingKey).toString("base64url");
    };
    const capture = (callback) => { try { callback(); return null; } catch (error) { return error.code; } };
    const valid = subject.verifyTelegramIdToken({ token: make(), keys: [key], expectedAudience: "telegram-client", expectedNonce: "expected-nonce", nowSeconds: now });
    console.log(JSON.stringify({
      subject: valid.sub,
      signature: capture(() => subject.verifyTelegramIdToken({ token: make({}, attacker.privateKey), keys: [key], expectedAudience: "telegram-client", expectedNonce: "expected-nonce", nowSeconds: now })),
      issuer: capture(() => subject.verifyTelegramIdToken({ token: make({ iss: "https://evil.example" }), keys: [key], expectedAudience: "telegram-client", expectedNonce: "expected-nonce", nowSeconds: now })),
      audience: capture(() => subject.verifyTelegramIdToken({ token: make(), keys: [key], expectedAudience: "wrong", expectedNonce: "expected-nonce", nowSeconds: now })),
      expired: capture(() => subject.verifyTelegramIdToken({ token: make({ exp: now - 1 }), keys: [key], expectedAudience: "telegram-client", expectedNonce: "expected-nonce", nowSeconds: now })),
      nonce: capture(() => subject.verifyTelegramIdToken({ token: make(), keys: [key], expectedAudience: "telegram-client", expectedNonce: "wrong", nowSeconds: now }))
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    subject: "123456789",
    signature: "id_token_signature",
    issuer: "id_token_issuer",
    audience: "id_token_audience",
    expired: "id_token_expired",
    nonce: "id_token_nonce"
  });
});

test("Telegram login validates against a bundled official RS256 key without blocking on live JWKS", () => {
  const snapshot = read("src/lib/auth/social/telegram-jwks-snapshot.ts");
  const library = read("src/lib/auth/social/telegram-library.ts");

  assert.match(snapshot, /TELEGRAM_JWKS_SNAPSHOT_UPDATED_AT = "2026-08-20"/);
  assert.match(snapshot, /kid: "oidc-1"/);
  assert.match(snapshot, /alg: "RS256"/);
  assert.match(snapshot, /key_ops: \["verify"\]/);
  assert.doesNotMatch(snapshot, /\b(?:d|p|q|dp|dq|qi):/);
  assert.match(library, /keys: bundledKeys/);
  assert.match(library, /refreshTelegramKeysInBackground\(\)/);
  assert.match(library, /if \(failure\.code !== "id_token_signing_key"\) throw failure/);
  assert.ok(library.indexOf("return cachedKeys.keys") < library.indexOf("return fetchTelegramKeys()"));
});

test("identity decisions create or link only from a verified provider identity", () => {
  const output = importTypescriptScript("src/lib/auth/social/linking-rules.ts", `
    const base = { existingIdentityUserId: null, providerPhone: "+79991234567", providerPhoneVerified: true, phoneOwner: null };
    console.log(JSON.stringify([
      subject.resolveVerifiedSocialIdentity(base),
      subject.resolveVerifiedSocialIdentity({ ...base, phoneOwner: { userId: "existing", verified: true } }),
      subject.resolveVerifiedSocialIdentity({ ...base, phoneOwner: { userId: "unverified", verified: false } }),
      subject.resolveVerifiedSocialIdentity({ ...base, providerPhone: null, providerPhoneVerified: false }),
      subject.resolveVerifiedSocialIdentity({ ...base, existingIdentityUserId: "telegram-owner" })
    ]));
  `);
  const [created, linked, unverified, missingPhone, existing] = JSON.parse(output);
  assert.equal(created.kind, "create_customer");
  assert.deepEqual(linked, { kind: "verified_phone", userId: "existing" });
  assert.equal(unverified.kind, "needs_phone_confirmation");
  assert.equal(missingPhone.kind, "needs_phone_confirmation");
  assert.deepEqual(existing, { kind: "existing_identity", userId: "telegram-owner" });

  const identity = read("src/lib/auth/social/identity.ts");
  assert.match(identity, /unique|identity_conflict|on conflict \(provider, provider_user_id\)/i);
  assert.doesNotMatch(identity, /where display_name|where username/i);
});

test("library completion validates first, creates a readable session, and returns only a safe local path", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  const start = read("src/app/api/auth/social/telegram/library/start/route.ts");
  const client = read("src/components/auth/TelegramLoginButton.tsx");
  assert.match(complete, /verifyTelegramLibraryIdToken/);
  assert.ok(complete.indexOf("const claims = await verifyTelegramLibraryIdToken") < complete.indexOf("const result = await completeProviderCallback"));
  assert.match(identity, /await setCustomerSession\(userId\)/);
  assert.match(identity, /const session = await getCustomerSession\(\)/);
  assert.match(identity, /session\.customerId !== userId/);
  assert.match(start, /sanitizeSocialRedirect/);
  assert.match(client, /router\.replace\(payload\.returnTo/);
  assert.doesNotMatch(client, /router\.replace\(returnTo\)/);
});

test("popup-compatible headers are limited to pages that host Telegram Login", () => {
  const config = read("next.config.mjs");
  assert.match(config, /same-origin-allow-popups/);
  assert.match(config, /https:\/\/oauth\.telegram\.org/);
  assert.match(config, /\["\/login", "\/register", "\/profile"\]/);
  assert.match(config, /source: "\/\(\.\*\)"/);
  assert.match(config, /Cross-Origin-Opener-Policy", value: "same-origin"/);
});

test("manual Telegram code exchange is removed from runtime while VK callback remains", () => {
  const start = read("src/app/api/auth/social/[provider]/start/route.ts");
  const callback = read("src/app/api/auth/social/[provider]/callback/route.ts");
  assert.equal(existsSync(join(root, "src/lib/auth/social/telegram.ts")), false);
  assert.doesNotMatch(`${start}\n${callback}`, /exchangeTelegramCode|getTelegramAuthorizeUrl|token_exchange\.start/);
  assert.match(start, /rawProvider === "telegram"/);
  assert.match(callback, /official JavaScript Login Library/);
  assert.match(callback, /exchangeVkCode/);
});

test("Telegram telemetry has library stages and cannot log tokens or phone claims", () => {
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  const clientComplete = read("src/app/api/auth/social/telegram/library/client-complete/route.ts");
  const telemetry = read("src/lib/auth/social/telegram-observability.ts");
  const sources = `${complete}\n${clientComplete}\n${telemetry}`;
  for (const event of [
    "telegram.library.start",
    "telegram.library.result",
    "telegram.id_token.valid",
    "telegram.identity.resolved",
    "telegram.session.created",
    "telegram.session.readback",
    "telegram.client.completed"
  ]) {
    assert.match(sources, new RegExp(event.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(telemetry, /idToken\??:|client_secret|access_token|phone_number\??:|cookie_value/i);
  assert.doesNotMatch(complete, /console\.(?:info|log|error)\([^)]*(?:idToken|parsed\.data)/);
});
