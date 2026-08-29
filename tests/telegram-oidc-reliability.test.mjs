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

function readProductionHeaders() {
  const moduleUrl = pathToFileURL(join(root, "next.config.mjs")).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `const { default: config } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(await config.headers()));`],
    { encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function parseCsp(value) {
  return Object.fromEntries(value.split(";").map((directive) => {
    const [name, ...tokens] = directive.trim().split(/\s+/);
    return [name, tokens];
  }));
}

test("Telegram attempt separates provider verification from active-browser consumption", () => {
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
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  assert.match(state, /status = 'provider_verified'/);
  assert.match(state, /status = 'completed'/);
  assert.match(state, /identity_ciphertext = \$\{identityCiphertext\}/);
  assert.match(state, /browser_consumed_at = coalesce\(browser_consumed_at, now\(\)\)/);
  assert.match(state, /expires_at > now\(\)/);
  assert.match(complete, /completeTelegramProviderAttempt/);
  assert.doesNotMatch(complete, /completeProviderCallback|setCustomerSession/);
  assert.match(consume, /completeProviderCallback/);
});

test("Telegram phone normalization accepts Russian E.164 with and without plus", () => {
  const output = importTypescriptScript("src/lib/auth/social/telegram-protocol.ts", `
    console.log(JSON.stringify([
      subject.normalizeTelegramPhone("+79991234567"),
      subject.normalizeTelegramPhone("79991234567"),
      subject.normalizeTelegramPhone("89991234567"),
      subject.normalizeTelegramPhone("9991234567"),
      subject.normalizeTelegramPhone("+441234567890"),
      subject.isTelegramPhoneVerified("+79991234567", undefined),
      subject.isTelegramPhoneVerified("+79991234567", true),
      subject.isTelegramPhoneVerified("+79991234567", false),
      subject.isTelegramPhoneVerified(null, undefined)
    ]));
  `);
  assert.deepEqual(JSON.parse(output), [
    "+79991234567", "+79991234567", "+79991234567", "+79991234567", null,
    true, true, false, false
  ]);
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
  const [created, linked, legacyLinked, missingPhone, existing] = JSON.parse(output);
  assert.equal(created.kind, "create_customer");
  assert.deepEqual(linked, { kind: "verified_phone", userId: "existing" });
  assert.deepEqual(legacyLinked, { kind: "verified_phone", userId: "unverified" });
  assert.equal(missingPhone.kind, "needs_phone_confirmation");
  assert.deepEqual(existing, { kind: "existing_identity", userId: "telegram-owner" });

  const identity = read("src/lib/auth/social/identity.ts");
  assert.match(identity, /unique|identity_conflict|on conflict \(provider, provider_user_id\)/i);
  assert.match(identity, /phone_verified_at = case/);
  assert.doesNotMatch(identity, /where display_name|where username/i);
});

test("library completion validates first while active-browser consume creates and reads back the session", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  const clientComplete = read("src/app/api/auth/social/telegram/client-complete/route.ts");
  const start = read("src/app/api/auth/social/telegram/library/start/route.ts");
  const client = read("src/components/auth/TelegramLoginButton.tsx");
  assert.match(complete, /verifyTelegramLibraryIdToken/);
  assert.ok(complete.indexOf("const claims = await verifyTelegramLibraryIdToken") < complete.lastIndexOf("await completeTelegramProviderAttempt"));
  assert.doesNotMatch(complete, /completeProviderCallback|setCustomerSession/);
  assert.match(consume, /completeProviderCallback/);
  assert.match(consume, /telegram\.session\.readback\.ok/);
  assert.match(identity, /await setCustomerSession\(userId\)/);
  assert.match(identity, /const session = await getCustomerSession\(\)/);
  assert.match(identity, /session\.customerId !== userId/);
  assert.match(start, /sanitizeSocialRedirect/);
  assert.match(clientComplete, /acknowledgeTelegramAttempt/);
  assert.match(client, /router\.replace\(nextPath/);
  assert.doesNotMatch(client, /router\.replace\(returnTo\)/);
});

test("Telegram browser coordinator pauses while hidden and resumes on pageshow, focus and visibility", () => {
  const client = read("src/components/auth/TelegramLoginButton.tsx");
  const status = read("src/app/api/auth/social/telegram/status/route.ts");
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  assert.match(client, /document\.visibilityState !== "visible"/);
  assert.match(client, /window\.addEventListener\("pageshow", onPageShow\)/);
  assert.match(client, /window\.addEventListener\("focus", onFocus\)/);
  assert.match(client, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(client, /if \(document\.visibilityState === "visible"\) poll\("visibility"\)/);
  assert.match(client, /\/api\/auth\/social\/telegram\/status/);
  assert.match(client, /\/api\/auth\/social\/telegram\/consume/);
  assert.match(status, /export async function GET/);
  assert.doesNotMatch(status, /completeProviderCallback|setCustomerSession|markTelegramAttemptConsumed/);
  assert.match(consume, /markTelegramAttemptPrepared/);
});

test("Telegram consume is browser-bound, leased and idempotent until cookie acknowledgement", () => {
  const state = read("src/lib/auth/social/state.ts");
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  const acknowledgement = read("src/app/api/auth/social/telegram/client-complete/route.ts");
  assert.match(state, /processing_at is null or processing_at < now\(\) - make_interval/);
  assert.match(state, /if \(existing\.browser_consumed_at\)/);
  assert.match(state, /preparedResult: claimed\.completion_result/);
  assert.match(state, /resolvedUserId: claimed\.resolved_user_id/);
  assert.match(consume, /result\.kind === "waiting"/);
  assert.match(consume, /getCustomerSession\(\)/);
  assert.match(consume, /readPendingSocialIdentity\(\)/);
  assert.match(consume, /preparedSessionIsReadable/);
  assert.match(consume, /currentSession\.customerId === claimed\.resolvedUserId/);
  assert.match(state, /proof\.sessionUserId !== attempt\.resolved_user_id/);
  assert.match(acknowledgement, /clearTelegramAttemptCookie/);
  assert.ok(acknowledgement.indexOf("acknowledgeTelegramAttempt") < acknowledgement.indexOf("clearTelegramAttemptCookie"));
});

test("existing Telegram identity signs in without phone while new missing-phone identity stays pending", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  const complete = read("src/components/auth/SocialCompleteForm.tsx");
  assert.ok(identity.indexOf("let userId = existingIdentity?.user_id ?? null") < identity.indexOf("if (!userId) {"));
  assert.match(identity, /if \(!userId\) return null/);
  assert.match(identity, /createPendingSocialIdentity\(claims, attempt\.redirectTo\)/);
  assert.match(consume, /status === "needs_phone" \? "\/login\/social\/complete"/);
  assert.doesNotMatch(complete, /SMS|СМС|смс/);
});

test("Telegram lifecycle migration is applied by the standalone runtime without touching MAX", () => {
  const runtime = read("scripts/apply-runtime-schema-migrations.mjs");
  const dockerfile = read("Dockerfile");
  const migration = read("supabase/migrations/20260824120000_add_telegram_browser_consume.sql");
  const maxChallenge = read("src/lib/auth/social/max-challenge.ts");
  assert.match(runtime, /20260824120000_add_telegram_browser_consume/);
  assert.match(runtime, /objects\?\.lifecycle_columns/);
  assert.match(dockerfile, /20260824120000_add_telegram_browser_consume\.sql/);
  assert.match(migration, /enable row level security|oauth_login_attempts/);
  assert.match(migration, /to karimoff_app/);
  assert.match(maxChallenge, /getMaxBrowserChallengeStatus/);
});

test("production CSP allows only the official Telegram Login origin on auth documents", () => {
  const headers = readProductionHeaders();
  const globalRule = headers.find((rule) => rule.source === "/(.*)");
  const loginRule = headers.find((rule) => rule.source === "/login");
  assert.ok(globalRule);
  assert.ok(loginRule);

  const globalCsp = globalRule.headers.find((header) => header.key === "Content-Security-Policy")?.value;
  const loginCsp = loginRule.headers.find((header) => header.key === "Content-Security-Policy")?.value;
  const globalCoop = globalRule.headers.find((header) => header.key === "Cross-Origin-Opener-Policy")?.value;
  const loginCoop = loginRule.headers.find((header) => header.key === "Cross-Origin-Opener-Policy")?.value;
  assert.ok(globalCsp);
  assert.ok(loginCsp);

  const directives = parseCsp(loginCsp);
  assert.deepEqual(directives["script-src"], ["'self'", "'unsafe-inline'", "https://oauth.telegram.org"]);
  assert.deepEqual(directives["connect-src"], ["'self'", "https://oauth.telegram.org"]);
  assert.deepEqual(directives["form-action"], ["'self'"]);
  assert.equal(directives["frame-src"], undefined);
  assert.equal(directives["child-src"], undefined);
  assert.ok(directives["img-src"].every((origin) => !origin.includes("telegram")));
  assert.ok(Object.values(directives).flat().every((token) => token !== "*" && token !== "'unsafe-eval'"));
  assert.doesNotMatch(globalCsp, /oauth\.telegram\.org/);
  assert.equal(globalCoop, "same-origin");
  assert.equal(loginCoop, "same-origin-allow-popups");
});

test("public auth links reload the document so route CSP and COOP take effect", () => {
  const documentLink = read("src/components/auth/AuthDocumentLink.tsx");
  const header = read("src/components/Header.tsx");
  const drawer = read("src/components/cart/CartDrawer.tsx");
  const paymentReturn = read("src/components/payments/PaymentReturnStatus.tsx");

  assert.match(documentLink, /return <a href=\{href\}/);
  assert.match(header, /<AuthDocumentLink[\s\S]*href=\{customerName \? "\/profile" : "\/login"\}/);
  assert.match(drawer, /<AuthDocumentLink[\s\S]{0,120}href="\/login\?redirectTo=%2Fcheckout"/);
  assert.match(drawer, /<AuthDocumentLink[\s\S]{0,120}href="\/register\?redirectTo=%2Fcheckout"/);
  assert.match(paymentReturn, /<AuthDocumentLink href="\/profile\/orders"/);
  assert.doesNotMatch(header, /<Link[\s\S]{0,120}href=\{customerName \? "\/profile" : "\/login"\}/);
});

test("manual Telegram and VK callback runtimes stay removed while Telegram library remains intact", () => {
  const start = read("src/app/api/auth/social/telegram/library/start/route.ts");
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  assert.equal(existsSync(join(root, "src/lib/auth/social/telegram.ts")), false);
  assert.equal(existsSync(join(root, "src/lib/auth/social/vk.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/start/route.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/callback/route.ts")), false);
  assert.doesNotMatch(`${start}\n${complete}`, /exchangeTelegramCode|getTelegramAuthorizeUrl|exchangeVkCode|token_exchange\.start/);
  assert.match(start, /getTelegramLoginLibraryConfig/);
  assert.match(complete, /verifyTelegramLibraryIdToken/);
});

test("Telegram telemetry has library stages and cannot log tokens or phone claims", () => {
  const complete = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  const consume = read("src/app/api/auth/social/telegram/consume/route.ts");
  const status = read("src/app/api/auth/social/telegram/status/route.ts");
  const clientComplete = read("src/app/api/auth/social/telegram/client-complete/route.ts");
  const telemetry = read("src/lib/auth/social/telegram-observability.ts");
  const sources = `${complete}\n${consume}\n${status}\n${clientComplete}\n${telemetry}`;
  for (const event of [
    "telegram.login.started",
    "telegram.library.start",
    "telegram.library.result",
    "telegram.id_token.valid",
    "telegram.provider.verified",
    "telegram.challenge.completed",
    "telegram.browser.resume",
    "telegram.browser.status.completed",
    "telegram.browser.consume",
    "telegram.identity.resolved",
    "telegram.session.created",
    "telegram.session.readback.ok",
    "telegram.redirect.success"
  ]) {
    assert.match(sources, new RegExp(event.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(telemetry, /idToken\??:|client_secret|access_token|phone_number\??:|cookie_value/i);
  assert.match(telemetry, /phone_present/);
  assert.match(telemetry, /phone_verified/);
  assert.doesNotMatch(complete, /console\.(?:info|log|error)\([^)]*(?:idToken|parsed\.data)/);
});
