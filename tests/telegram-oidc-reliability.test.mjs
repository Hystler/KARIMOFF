import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Telegram mobile callback accepts a missing optional browser cookie but rejects mismatches", () => {
  const output = importTypescriptScript("src/lib/auth/social/state-policy.ts", `
    const capture = (callback) => { try { return callback(); } catch (error) { return error.code; } };
    console.log(JSON.stringify({
      missingTelegram: capture(() => subject.validateOAuthBrowserBinding({ provider: "telegram", cookieState: null, returnedState: "state" })),
      matchingTelegram: capture(() => subject.validateOAuthBrowserBinding({ provider: "telegram", cookieState: "state", returnedState: "state" })),
      mismatch: capture(() => subject.validateOAuthBrowserBinding({ provider: "telegram", cookieState: "other", returnedState: "state" })),
      missingVk: capture(() => subject.validateOAuthBrowserBinding({ provider: "vk", cookieState: null, returnedState: "state" }))
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    missingTelegram: "missing",
    matchingTelegram: "matched",
    mismatch: "browser_binding_mismatch",
    missingVk: "browser_binding_mismatch"
  });
});

test("OAuth state failures distinguish missing, expired and replayed attempts", () => {
  const output = importTypescriptScript("src/lib/auth/social/state-policy.ts", `
    const now = Date.parse("2026-08-19T09:00:00.000Z");
    console.log(JSON.stringify([
      subject.classifyOAuthAttemptFailure({ exists: false, consumedAt: null, expiresAt: null, nowMs: now }).code,
      subject.classifyOAuthAttemptFailure({ exists: true, consumedAt: "2026-08-19T08:59:00.000Z", expiresAt: "2026-08-19T09:10:00.000Z", nowMs: now }).code,
      subject.classifyOAuthAttemptFailure({ exists: true, consumedAt: null, expiresAt: "2026-08-19T08:59:00.000Z", nowMs: now }).code
    ]));
  `);
  assert.deepEqual(JSON.parse(output), ["state_not_found", "state_replay", "expired_state"]);
});

test("Telegram token endpoint errors are recognized even when Telegram returns HTTP 200", () => {
  const output = importTypescriptScript("src/lib/auth/social/telegram-protocol.ts", `
    const capture = (params) => { try { subject.parseTelegramTokenResponse(params); return null; } catch (error) { return { code: error.code, status: error.httpStatus, provider: error.providerError }; } };
    const success = subject.parseTelegramTokenResponse({ payload: { id_token: "x".repeat(40), token_type: "Bearer" }, ok: true, status: 200 });
    console.log(JSON.stringify({
      success: success.token_type,
      invalidGrant200: capture({ payload: { error: "invalid_grant" }, ok: true, status: 200 }),
      invalidGrant400: capture({ payload: { error: "invalid_grant" }, ok: false, status: 400 }),
      invalidPayload: capture({ payload: { unexpected: true }, ok: true, status: 200 })
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    success: "Bearer",
    invalidGrant200: { code: "token_rejected", status: 200, provider: "invalid_grant" },
    invalidGrant400: { code: "token_rejected", status: 400, provider: "invalid_grant" },
    invalidPayload: { code: "token_response_invalid", status: 200, provider: null }
  });
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

test("Telegram real-format RS256 claims reject signature, issuer, audience, expiry and nonce failures", () => {
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

test("identity decisions create a customer only for a new verified provider phone", () => {
  const output = importTypescriptScript("src/lib/auth/social/linking-rules.ts", `
    const base = { existingIdentityUserId: null, providerPhone: "+79991234567", providerPhoneVerified: true, phoneOwner: null };
    console.log(JSON.stringify([
      subject.resolveVerifiedSocialIdentity(base),
      subject.resolveVerifiedSocialIdentity({ ...base, phoneOwner: { userId: "existing", verified: true } }),
      subject.resolveVerifiedSocialIdentity({ ...base, phoneOwner: { userId: "unverified", verified: false } }),
      subject.resolveVerifiedSocialIdentity({ ...base, providerPhoneVerified: false }),
      subject.resolveVerifiedSocialIdentity({ ...base, existingIdentityUserId: "telegram-owner" })
    ]));
  `);
  const [created, linked, unverified, missingVerification, existing] = JSON.parse(output);
  assert.equal(created.kind, "create_customer");
  assert.deepEqual(linked, { kind: "verified_phone", userId: "existing" });
  assert.equal(unverified.kind, "needs_phone_confirmation");
  assert.equal(missingVerification.kind, "needs_phone_confirmation");
  assert.deepEqual(existing, { kind: "existing_identity", userId: "telegram-owner" });
});

test("callback creates and verifies the KARIMOFF session before a safe local redirect", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const callback = read("src/app/api/auth/social/[provider]/callback/route.ts");
  const state = read("src/lib/auth/social/state.ts");
  assert.match(identity, /insert into public\.customers/);
  assert.match(identity, /await setCustomerSession\(userId\)/);
  assert.match(identity, /const session = await getCustomerSession\(\)/);
  assert.match(identity, /session\.customerId !== userId/);
  assert.match(callback, /telegram\.session\.created/);
  assert.match(callback, /telegram\.redirect\.success/);
  assert.match(state, /redirectTo: sanitizeSocialRedirect/);
});

test("Telegram callback telemetry contains stages and correlation only, never OAuth secrets", () => {
  const callback = read("src/app/api/auth/social/[provider]/callback/route.ts");
  const telemetry = read("src/lib/auth/social/telegram-observability.ts");
  const telegram = read("src/lib/auth/social/telegram.ts");
  for (const event of [
    "telegram.start",
    "telegram.callback.received",
    "telegram.token_exchange.success",
    "telegram.id_token.valid",
    "telegram.identity.resolved",
    "telegram.session.created",
    "telegram.redirect.success"
  ]) {
    assert.match(`${callback}\n${telemetry}`, new RegExp(event.replaceAll(".", "\\.")));
  }
  assert.match(telegram, /TELEGRAM_TOKEN_TIMEOUT_MS = 30_000/);
  assert.match(telegram, /TELEGRAM_JWKS_RETRIES = 3/);
  assert.match(telegram, /Authorization: `Basic/);
  assert.match(telegram, /"Content-Type": "application\/x-www-form-urlencoded"/);
  assert.doesNotMatch(telemetry, /authorization_code|client_secret|access_token|phone_number|cookie_value/i);
});
