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

test("MAX validates official WebAppData HMAC, freshness and signed start_param", () => {
  const output = importTypescriptScript("src/lib/auth/social/max-protocol.ts", `
    const { createHmac } = await import("node:crypto");
    const token = "123456.test-only-token";
    const now = 2_000_000_000;
    const challenge = "a".repeat(43);
    const user = JSON.stringify({ id: 123456789, first_name: "Иван Иванов", last_name: "Тестов", username: "ivan_test", language_code: "ru", photo_url: "https://example.test/avatar.jpg" });
    const sign = (values) => {
      const launch = Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => key + "=" + value).join("\\n");
      const secret = createHmac("sha256", "WebAppData").update(token).digest();
      return createHmac("sha256", secret).update(launch).digest("hex");
    };
    const raw = (values) => {
      const hash = sign(values);
      return Object.entries({ ...values, hash }).map(([key, value]) => key + "=" + encodeURIComponent(value).replaceAll("%20", "+")).join("&");
    };
    const base = { auth_date: String(now - 10), query_id: "query-1", start_param: challenge, user };
    const capture = (callback) => { try { callback(); return null; } catch (error) { return error.code; } };
    const valid = subject.validateMaxWebAppData({ initData: raw(base), botToken: token, nowSeconds: now });
    const signed = raw(base);
    const alteredUser = signed.replace(encodeURIComponent(user).replaceAll("%20", "+"), encodeURIComponent(user.replace("Иван", "Злоумышленник")).replaceAll("%20", "+"));
    console.log(JSON.stringify({
      providerUserId: valid.claims.providerUserId,
      displayName: valid.claims.displayName,
      challenge: valid.challenge,
      altered: capture(() => subject.validateMaxWebAppData({ initData: alteredUser, botToken: token, nowSeconds: now })),
      badHash: capture(() => subject.validateMaxWebAppData({ initData: signed.replace(/hash=[a-f0-9]+/, "hash=" + "0".repeat(64)), botToken: token, nowSeconds: now })),
      duplicateHash: capture(() => subject.validateMaxWebAppData({ initData: signed + "&hash=" + "0".repeat(64), botToken: token, nowSeconds: now })),
      duplicateParam: capture(() => subject.validateMaxWebAppData({ initData: signed + "&user=" + encodeURIComponent(user), botToken: token, nowSeconds: now })),
      expired: capture(() => subject.validateMaxWebAppData({ initData: raw({ ...base, auth_date: String(now - 3601) }), botToken: token, nowSeconds: now })),
      future: capture(() => subject.validateMaxWebAppData({ initData: raw({ ...base, auth_date: String(now + 61) }), botToken: token, nowSeconds: now })),
      malformed: capture(() => subject.validateMaxWebAppData({ initData: "not-a-query", botToken: token, nowSeconds: now })),
      badChallenge: capture(() => subject.validateMaxWebAppData({ initData: raw({ ...base, start_param: "short" }), botToken: token, nowSeconds: now })),
      missingToken: capture(() => subject.validateMaxWebAppData({ initData: signed, botToken: "", nowSeconds: now }))
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    providerUserId: "123456789",
    displayName: "Иван Иванов Тестов",
    challenge: "a".repeat(43),
    altered: "init_data_hash_invalid",
    badHash: "init_data_hash_invalid",
    duplicateHash: "init_data_duplicate",
    duplicateParam: "init_data_duplicate",
    expired: "init_data_expired",
    future: "init_data_future",
    malformed: "init_data_malformed",
    badChallenge: "start_param_invalid",
    missingToken: "bot_token_missing"
  });
});

test("MAX contact validation binds a fresh signed phone to the validated user", () => {
  const output = importTypescriptScript("src/lib/auth/social/max-protocol.ts", `
    const { createHmac } = await import("node:crypto");
    const token = "123456.test-only-token";
    const now = 2_000_000_000;
    const userId = "123456789";
    const make = (phone = "+7 (999) 123-45-67", authDate = String(now - 10), signedUser = userId) => {
      const digits = phone.replace(/\\D/g, "");
      const data = ["authDate=" + authDate, "phone=" + digits, "userId=" + signedUser].join("\\n");
      return { authDate, phone, hash: createHmac("sha256", token).update(data).digest("hex") };
    };
    const capture = (callback) => { try { return callback(); } catch (error) { return error.code; } };
    const valid = subject.validateMaxContact({ contact: make(), botToken: token, userId, nowSeconds: now });
    console.log(JSON.stringify({
      valid,
      withoutPlus: subject.validateMaxContact({ contact: make("79991234567"), botToken: token, userId, nowSeconds: now }),
      wrongUser: capture(() => subject.validateMaxContact({ contact: make("79991234567", String(now - 10), "987654321"), botToken: token, userId, nowSeconds: now })),
      invalidHash: capture(() => subject.validateMaxContact({ contact: { ...make(), hash: "0".repeat(64) }, botToken: token, userId, nowSeconds: now })),
      expired: capture(() => subject.validateMaxContact({ contact: make("79991234567", String(now - 301)), botToken: token, userId, nowSeconds: now })),
      future: capture(() => subject.validateMaxContact({ contact: make("79991234567", String(now + 61)), botToken: token, userId, nowSeconds: now })),
      foreignPhone: capture(() => subject.validateMaxContact({ contact: make("441234567890"), botToken: token, userId, nowSeconds: now })),
      missingToken: capture(() => subject.validateMaxContact({ contact: make(), botToken: "", userId, nowSeconds: now }))
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    valid: "+79991234567",
    withoutPlus: "+79991234567",
    wrongUser: "contact_hash_invalid",
    invalidHash: "contact_hash_invalid",
    expired: "contact_expired",
    future: "contact_future",
    foreignPhone: "contact_phone_invalid",
    missingToken: "bot_token_missing"
  });
});

test("MAX challenge is random, hashed, browser-bound, expiring and one-time", () => {
  const challenge = read("src/lib/auth/social/max-challenge.ts");
  const migration = read("supabase/migrations/20260820190000_add_max_social_auth.sql");
  const runtimeMigrations = read("scripts/apply-runtime-schema-migrations.mjs");
  const start = read("src/app/api/auth/social/max/start/route.ts");
  const status = read("src/app/api/auth/social/max/status/route.ts");

  assert.match(challenge, /randomBase64Url\(32\)/);
  assert.match(challenge, /MAX_CHALLENGE_TTL_MS = 5 \* 60_000/);
  assert.match(challenge, /hashOAuthSecret\(challenge\)/);
  assert.match(challenge, /hashOAuthSecret\(browserBinding\)/);
  assert.match(challenge, /httpOnly: true/);
  assert.match(challenge, /sameSite: "lax"/);
  assert.match(challenge, /path: "\/"/);
  assert.match(challenge, /for update/);
  assert.match(challenge, /status === "completed".*challenge_replay/);
  assert.match(challenge, /browser_binding_mismatch/);
  assert.match(challenge, /used_at is null/);
  assert.match(challenge, /processing_at is null/);
  assert.match(challenge, /encryptOAuthSecret\(JSON\.stringify\(params\.claims\)\)/);
  assert.match(challenge, /identity_ciphertext = null/);
  assert.match(start, /startapp=\$\{attempt\.challenge\}/);
  assert.doesNotMatch(start, /phone|displayName|username|avatar/i);
  assert.match(status, /completeProviderCallback/);
  assert.match(status, /markMaxChallengeConsumed/);
  assert.match(migration, /challenge_hash text not null unique/);
  assert.match(migration, /correlation_id uuid not null unique/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all privileges.*from public/);
  assert.match(migration, /to karimoff_app/);
  assert.match(runtimeMigrations, /from pg_attribute/);
  assert.doesNotMatch(runtimeMigrations, /information_schema/);
});

test("MAX linking does not merge by profile data or an unverified local phone", () => {
  const identity = read("src/lib/auth/social/identity.ts");
  assert.match(identity, /claims\.provider === "max" && phoneOwner && !phoneOwner\.phone_verified_at/);
  assert.match(identity, /where provider = \$\{claims\.provider\}/);
  assert.match(identity, /provider_user_id = \$\{claims\.providerUserId\}/);
  assert.match(identity, /identity_conflict/);
  assert.doesNotMatch(identity, /where display_name|where username|where avatar_url/i);
  assert.match(identity, /insert into public\.customers/);
  assert.match(identity, /createPendingSocialIdentity/);
});

test("MAX browser coordinator completes without depending on app-to-browser switching", () => {
  const button = read("src/components/auth/MaxLoginButton.tsx");
  const miniApp = read("src/components/auth/MaxMiniApp.tsx");
  const complete = read("src/app/api/auth/social/max/complete/route.ts");
  const status = read("src/app/api/auth/social/max/status/route.ts");
  const config = read("next.config.mjs");

  assert.match(button, /target="_blank"/);
  assert.match(button, /window\.open\("about:blank", "_blank"\)/);
  assert.match(button, /const nextAttempt = await createAttempt\(\)/);
  assert.match(button, /onClick=\{\(\) => void beginLogin\(\)\}/);
  assert.match(button, /setInterval\(poll, 2_000\)/);
  assert.match(button, /visibilitychange/);
  assert.match(button, /После подтверждения вернитесь сюда — вход завершится автоматически/);
  assert.match(button, /router\.replace\(payload\.returnTo/);
  assert.match(miniApp, /https:\/\/st\.max\.ru\/js\/max-web-app\.js/);
  assert.match(miniApp, /window\.WebApp\.requestContact\(\)/);
  assert.match(miniApp, /window\.WebApp\?\.initData/);
  assert.doesNotMatch(miniApp, /initDataUnsafe/);
  assert.match(miniApp, /Подтвердить номер/);
  assert.match(complete, /validateMaxWebAppData/);
  assert.match(complete, /validateMaxContact/);
  assert.match(status, /getCustomerSession/);
  assert.match(config, /source: "\/integrations\/max\/app"/);
  assert.match(config, /https:\/\/st\.max\.ru/);
});

test("MAX UI, profile and admin expose only safe identity details", () => {
  const buttons = read("src/components/auth/SocialAuthButtons.tsx");
  const profile = read("src/app/profile/page.tsx");
  const profileActions = read("src/app/profile/actions.ts");
  const detail = read("src/app/admin/customers/[id]/page.tsx");
  const list = read("src/lib/admin-customers.ts");
  const env = read(".env.example");
  const config = read("src/lib/auth/social/config.ts");

  assert.ok(buttons.indexOf("enabled.telegram") < buttons.indexOf("enabled.max"));
  assert.match(profile, /\["phone", "telegram", "max"\]/);
  assert.match(profile, /MaxLoginButton/);
  assert.match(profileActions, /provider in \('phone', 'telegram', 'max'\)/);
  assert.match(detail, /MAX user ID/);
  assert.match(detail, /Подтверждение телефона/);
  assert.match(detail, /Первый вход \/ привязка/);
  assert.match(list, /\["phone", "telegram", "max"\]/);
  assert.match(env, /^MAX_BOT_TOKEN=$/m);
  assert.match(env, /^MAX_BOT_NAME=$/m);
  assert.match(env, /^MAX_MINI_APP_URL=https:\/\//m);
  assert.doesNotMatch(env, /^NEXT_PUBLIC_MAX_/m);
  assert.match(config, /getMaxAuthDiagnostics/);
  assert.doesNotMatch(`${profile}\n${detail}\n${list}`, /WebAppData|MAX_BOT_TOKEN|access_token/i);
});

test("MAX runtime configuration reports exact safe reasons without exposing the bot token", () => {
  const output = importTypescriptScript("src/lib/auth/social/max-config-state.ts", `
    const inspect = (environment) => subject.inspectMaxAuthEnvironment(environment);
    const valid = inspect({
      MAX_BOT_TOKEN: "test-secret-never-returned",
      MAX_BOT_NAME: "karimoff_test_bot",
      MAX_MINI_APP_URL: "https://stand.example.test/integrations/max/app"
    });
    console.log(JSON.stringify({
      valid: valid.diagnostics,
      missingToken: inspect({ MAX_BOT_NAME: "karimoff_test_bot", MAX_MINI_APP_URL: "https://stand.example.test/integrations/max/app" }).diagnostics,
      invalidName: inspect({ MAX_BOT_TOKEN: "secret", MAX_BOT_NAME: "@karimoff_test_bot", MAX_MINI_APP_URL: "https://stand.example.test/integrations/max/app" }).diagnostics,
      wrongPath: inspect({ MAX_BOT_TOKEN: "secret", MAX_BOT_NAME: "karimoff_test_bot", MAX_MINI_APP_URL: "https://stand.example.test/integrations/max/app/" }).diagnostics,
      serialized: JSON.stringify(valid.diagnostics)
    }));
  `);
  const result = JSON.parse(output);
  assert.deepEqual(result.valid, {
    maxConfigured: true,
    hasBotToken: true,
    hasBotName: true,
    hasMiniAppUrl: true,
    effectiveBotName: "ka..._bot",
    reason: "configured"
  });
  assert.equal(result.missingToken.reason, "missing_bot_token");
  assert.equal(result.invalidName.reason, "invalid_bot_name");
  assert.equal(result.wrongPath.reason, "mini_app_url_path_mismatch");
  assert.doesNotMatch(result.serialized, /test-secret-never-returned|MAX_BOT_TOKEN/);
});

test("MAX Bot API foundation uses the current read-only endpoint and never exposes the bot token", () => {
  const client = read("src/lib/integrations/max/client.ts");
  const docs = read("docs/max-auth-integration.md");
  assert.match(client, /https:\/\/platform-api2\.max\.ru/);
  assert.match(client, /Authorization: config\.botToken/);
  assert.match(client, /method: "GET"/);
  assert.doesNotMatch(client, /POST|PUT|PATCH|DELETE|NEXT_PUBLIC/);
  assert.match(docs, /19 July 2026/);
  assert.match(docs, /Ministry of Digital Development certificate/);
});

test("VK runtime and configuration are absent while Telegram and phone auth remain", () => {
  const env = read(".env.example");
  const providers = read("src/lib/auth/social/types.ts");
  const telegram = read("src/components/auth/TelegramLoginButton.tsx");
  const phone = read("src/components/auth/AuthForm.tsx");
  assert.equal(existsSync(join(root, "src/lib/auth/social/vk.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/start/route.ts")), false);
  assert.equal(existsSync(join(root, "src/app/api/auth/social/[provider]/callback/route.ts")), false);
  assert.doesNotMatch(env, /^VK_/m);
  assert.deepEqual(providers.match(/socialProviders = \[([^\]]+)\]/)?.[1].match(/"[^"]+"/g), ["\"telegram\"", "\"max\""]);
  assert.match(telegram, /window\.Telegram\.Login\.auth/);
  assert.match(phone, /loginWithPasswordAction/);
  assert.match(phone, /requestLoginCodeAction/);
});
