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

test("social redirects preserve safe checkout returns and reject external redirects", () => {
  const output = importTypescriptScript("src/lib/auth/social/redirect.ts", `
    console.log(JSON.stringify([
      subject.sanitizeSocialRedirect("/checkout?step=delivery"),
      subject.sanitizeSocialRedirect("https://evil.example"),
      subject.sanitizeSocialRedirect("//evil.example")
    ]));
  `);
  assert.deepEqual(JSON.parse(output), ["/checkout?step=delivery", "/profile", "/profile"]);
});

test("Telegram is the primary human-readable login option and remains on the KARIMOFF page", () => {
  const social = read("src/components/auth/SocialAuthButtons.tsx");
  const telegram = read("src/components/auth/TelegramLoginButton.tsx");
  const authForm = read("src/components/auth/AuthForm.tsx");
  assert.match(telegram, /Войти через Telegram/);
  assert.match(telegram, /Быстрый вход без ввода пароля/);
  assert.match(telegram, /Вход выполняется через официальный Telegram/);
  assert.match(telegram, /Мы не публикуем ничего от вашего имени/);
  assert.match(telegram, /Подтвердите вход в Telegram/);
  assert.match(telegram, /После подтверждения вернитесь сюда — вход завершится автоматически/);
  assert.match(telegram, /SocialProviderIcon provider="telegram"/);
  assert.match(telegram, /router\.replace\(payload\.returnTo/);
  assert.doesNotMatch(telegram, /window\.location\s*=|oauth\.telegram\.org\/auth/);
  assert.ok(social.indexOf("enabled.telegram") < social.indexOf("enabled.max"));
  assert.ok(authForm.indexOf("<SocialAuthButtons") < authForm.indexOf("<form action={passwordAction}"));
});

test("official Telegram Login Library is configured in Russian with profile, phone and write scopes", () => {
  const telegram = read("src/components/auth/TelegramLoginButton.tsx");
  assert.match(telegram, /https:\/\/oauth\.telegram\.org\/js\/telegram-login\.js\?5/);
  assert.match(telegram, /window\.Telegram\.Login\.auth/);
  assert.match(telegram, /lang: "ru"/);
  assert.match(telegram, /nonce: attempt\.nonce/);
  assert.match(telegram, /scope: \["profile", "phone", "write"\]/);
  assert.doesNotMatch(telegram, /CLIENT_SECRET|clientSecret|TELEGRAM_OIDC_CLIENT_SECRET/);
});

test("missing provider configuration hides social controls without a client error", () => {
  const social = read("src/components/auth/SocialAuthButtons.tsx");
  const config = read("src/lib/auth/social/config.ts");
  assert.match(social, /if \(!hasProviders\) return null/);
  assert.match(config, /getTelegramLoginLibraryConfig/);
  assert.match(config, /telegram: Boolean\(getTelegramLoginLibraryConfig\(\)\)/);
  assert.match(config, /max: Boolean\(getMaxAuthConfig\(\)\)/);
});

test("Telegram cancellation, expiry and identity conflict are human-readable", () => {
  const telegram = read("src/components/auth/TelegramLoginButton.tsx");
  assert.match(telegram, /Вы отменили вход через Telegram/);
  assert.match(telegram, /Время подтверждения истекло/);
  assert.match(telegram, /Этот Telegram уже связан с другим аккаунтом/);
  assert.match(telegram, /Не удалось завершить вход/);
  assert.doesNotMatch(telegram, />\s*(Success|Callback|OAuth|Token|Authorization failed)\s*</);
});

test("missing Telegram phone continues through safe SMS confirmation", () => {
  const complete = read("src/components/auth/SocialCompleteForm.tsx");
  const action = read("src/app/login/social/complete/actions.ts");
  const libraryRoute = read("src/app/api/auth/social/telegram/library/complete/route.ts");
  assert.match(complete, /Telegram не передал номер телефона/);
  assert.match(complete, /Подтвердите номер по SMS/);
  assert.match(complete, /По имени или username аккаунты не объединяются/);
  assert.match(libraryRoute, /status: result\.kind/);
  assert.match(action, /Не удалось завершить вход\. Попробуйте позже\./);
});

test("Telegram profile names and identity status are available to admins without exposing tokens", () => {
  const telegram = read("src/lib/auth/social/telegram-library.ts");
  const detail = read("src/app/admin/customers/[id]/page.tsx");
  const list = read("src/app/admin/customers/page.tsx");
  assert.match(telegram, /givenName: claims\.given_name/);
  assert.match(telegram, /familyName: claims\.family_name/);
  assert.match(detail, /Telegram user ID/);
  assert.match(detail, /Имя \/ фамилия/);
  assert.match(detail, /Подтверждение телефона/);
  assert.match(detail, /Первый вход \/ привязка/);
  assert.match(detail, /Последний вход/);
  assert.match(detail, /Привязан к профилю/);
  assert.match(list, /IdentityProviderBadge/);
  assert.doesNotMatch(`${detail}\n${list}`, /access_token|refresh_token|client_secret/i);
});
