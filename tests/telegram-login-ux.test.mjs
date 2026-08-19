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

test("social result paths preserve safe checkout returns and reject external redirects", () => {
  const output = importTypescriptScript("src/lib/auth/social/redirect.ts", `
    console.log(JSON.stringify([
      subject.buildSocialResultPath({ provider: "telegram", status: "success", returnTo: "/checkout?step=delivery" }),
      subject.buildSocialResultPath({ provider: "telegram", status: "success", returnTo: "https://evil.example" }),
      subject.sanitizeSocialRedirect("//evil.example")
    ]));
  `);
  const [checkoutPath, externalPath, protocolRelative] = JSON.parse(output);
  assert.match(checkoutPath, /returnTo=%2Fcheckout%3Fstep%3Ddelivery/);
  assert.match(externalPath, /returnTo=%2Fprofile/);
  assert.equal(protocolRelative, "/profile");
});

test("Telegram is the primary human-readable social login option", () => {
  const social = read("src/components/auth/SocialAuthButtons.tsx");
  const authForm = read("src/components/auth/AuthForm.tsx");
  assert.match(social, /Войти через Telegram/);
  assert.match(social, /Быстрый вход без ввода пароля/);
  assert.match(social, /Вход выполняется через официальный Telegram/);
  assert.match(social, /Мы не публикуем ничего от вашего имени/);
  assert.match(social, /Если вы разрешите доступ, мы получим ваш номер телефона/);
  assert.match(social, /SocialProviderIcon provider="telegram"/);
  assert.doesNotMatch(social, /mark: "T"/);
  assert.ok(social.indexOf("enabled.telegram") < social.indexOf("enabled.vk"));
  assert.ok(authForm.indexOf("<SocialAuthButtons") < authForm.indexOf("<form action={passwordAction}"));
});

test("missing provider configuration hides social controls without a client error", () => {
  const social = read("src/components/auth/SocialAuthButtons.tsx");
  assert.match(social, /if \(!hasProviders\) return null/);
  assert.match(read("src/lib/auth/social/config.ts"), /return clientId && clientSecret && redirectUri/);
});

test("Telegram callback uses branded success and cancellation result screens", () => {
  const callback = read("src/app/api/auth/social/[provider]/callback/route.ts");
  const result = read("src/components/auth/SocialAuthResult.tsx");
  assert.match(callback, /buildSocialResultPath/);
  assert.match(callback, /reason: "cancelled"/);
  assert.match(callback, /status: "success"/);
  assert.match(result, /Вход подтверждён/);
  assert.match(result, /Мы успешно получили ваши данные из/);
  assert.match(result, /Сейчас вернём вас на сайт/);
  assert.match(result, /Вернуться в KARIMOFF/);
  assert.match(result, /window\.location\.replace\(returnTo\)/);
  assert.match(result, /1_650/);
  assert.match(result, /Не удалось подтвердить вход через Telegram\. Попробуйте ещё раз\./);
  assert.match(result, /Вы отменили вход через Telegram\./);
  assert.match(result, /Попробовать снова/);
  assert.match(result, /Вернуться ко входу/);
});

test("a forged success URL cannot show success without a valid customer session", () => {
  const page = read("src/app/login/social/result/page.tsx");
  assert.match(page, /await getCustomerSession\(\)/);
  assert.match(page, /requestedSuccess && customerSession \? "success" : "error"/);
});

test("missing Telegram phone continues through safe SMS confirmation", () => {
  const complete = read("src/components/auth/SocialCompleteForm.tsx");
  const action = read("src/app/login/social/complete/actions.ts");
  assert.match(complete, /Telegram не передал номер телефона/);
  assert.match(complete, /Подтвердите номер по SMS/);
  assert.match(complete, /По имени или username аккаунты не объединяются/);
  assert.match(action, /buildSocialResultPath/);
  assert.match(action, /Не удалось завершить вход\. Попробуйте позже\./);
});

test("Telegram profile names and identity status are available to admins without exposing tokens", () => {
  const telegram = read("src/lib/auth/social/telegram.ts");
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
