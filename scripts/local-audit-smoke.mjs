import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import ts from "typescript";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--disposable-audit")) throw new Error("Explicit disposable-audit argument required.");
if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error("Set PLAYWRIGHT_MODULE_PATH to an installed Playwright module.");
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href);
const container = "karimoff-site-audit-20260908";
const origin = "http://127.0.0.1:3108";
const output = resolve("outputs/site-audit-2026-09");
mkdirSync(output, { recursive: true });
const sql = postgres("postgres://postgres@127.0.0.1:55439/karimoff_audit", { max: 1, onnotice() {} });
const phone = "+79990000000";
const password = randomBytes(24).toString("base64url");
const passwordHash = await bcrypt.hash(password, 12);
let browser;
try {
  const catalogModule = {};
  new Function("exports", ts.transpileModule(readFileSync("src/lib/extras-catalog.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(catalogModule);
  for (const extra of catalogModule.extrasCatalog.filter(extra => extra.key !== "jalapeno")) {
    await sql`insert into ingredients(name,unit,cost_per_unit,waste_percent,is_active)
      select ${extra.name},${extra.unit},1,0,true where not exists(select 1 from ingredients where name=${extra.name})`;
  }
  // Every row here is synthetic and confined to the separately created disposable database.
  const [product] = await sql`
    insert into products(name,slug,category,description,price,image_url,is_active)
    values('Бургер для проверки','audit-burger','Бургеры','Сочный бургер с овощами и мягкой булочкой.',250,
      '/assets/products/burgers/tayson.webp',true)
    on conflict(slug) do update set is_active=true returning id
  `;
  let [ingredient] = await sql`select id from ingredients where name='Капуста для проверки'`;
  if (!ingredient) [ingredient] = await sql`
    insert into ingredients(name,unit,cost_per_unit,waste_percent,package_size,package_price,is_active)
    values('Капуста для проверки','g',0.035,20,1000,35,true) returning id
  `;
  await sql`insert into product_ingredients(product_id,ingredient_id,quantity,unit)
    select ${product.id},${ingredient.id},80,'g'
    where not exists(select 1 from product_ingredients where product_id=${product.id} and ingredient_id=${ingredient.id})`;
  await sql`insert into inventory_items(ingredient_id,current_quantity,reserved_quantity,min_quantity,unit)
    values(${ingredient.id},1000,200,100,'g') on conflict(ingredient_id) do nothing`;
  const [exists] = await sql`select count(*)::int as n from orders where customer_name='Local audit fixture'`;
  if (!exists.n) {
    for (let day = 1; day <= 28; day++) {
      const [order] = await sql`
        insert into orders(customer_name,customer_phone,total,status,payment_status,source,created_at,updated_at,kitchen_completed_at,is_test)
        values('Local audit fixture',${phone},500,'completed','not_required','site',
          now()-${day}*interval '1 day',now()-${day}*interval '1 day',now()-${day}*interval '1 day',false) returning id
      `;
      await sql`insert into order_items(order_id,product_id,product_name,unit_price,quantity,line_total)
        values(${order.id},${product.id},'Бургер для проверки',250,2,500)`;
    }
  }
  // No real provider credentials, workers or payments enter this container.
  const environment = {
    DATABASE_URL: "postgres://postgres@host.docker.internal:55439/karimoff_audit",
    APP_ORIGIN: origin, SESSION_SECRET: randomBytes(32).toString("hex"), ADMIN_PHONE: phone,
    ADMIN_PASSWORD_HASH: passwordHash, TEST_ORDER_MODE: "true", PAYMENTS_ENABLED: "false",
    EVOTOR_ENABLED: "false", EVOTOR_BACKGROUND_SYNC: "false", ORDER_STATUS_NOTIFICATIONS_ENABLED: "false",
    TELEGRAM_OIDC_CLIENT_ID: "12345", MAX_BOT_TOKEN: "local-mock-not-a-provider-token",
    MAX_BOT_NAME: "local_audit_bot", MAX_MINI_APP_URL: "https://audit.example.invalid/integrations/max/app"
  };
  const args = ["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1:3108:3000"];
  for (const [key, value] of Object.entries(environment)) args.push("-e", `${key}=${value}`);
  args.push(process.env.AUDIT_DOCKER_IMAGE || "karimoff-audit:20260908", "node", "server.js");
  execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch(origin).then((r) => r.ok).catch(() => false)) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: "ru-RU", extraHTTPHeaders: { "x-forwarded-proto": "http" } });
    await context.route("https://oauth.telegram.org/**", (route) => route.fulfill({
      contentType: "application/javascript", body: "window.Telegram={Login:{auth:function(){},close:function(){}}};"
    }));
    const page = await context.newPage();
    const exceptions = [];
    page.on("pageerror", (error) => exceptions.push(error.name));
    for (const path of ["/", "/menu", "/menu/audit-burger", "/login?redirectTo=%2Fcheckout", "/checkout", "/display"]) {
      const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
      const necessaryCookies = page.getByRole("button", { name: "Только необходимые", exact: true });
      if (await necessaryCookies.isVisible()) await necessaryCookies.click();
      assert.equal(response.status(), 200, path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${path}`);
      if (path.startsWith("/login")) {
        assert.equal(await page.locator('input[type="password"]').count(), 0);
        assert.equal(await page.getByRole("button", { name: /Войти через Telegram/ }).isEnabled(), true);
        assert.equal(await page.getByRole("button", { name: /Войти через MAX/ }).isEnabled(), true);
        assert.equal(await page.getByRole("button", { name: /SMS|СМС/ }).count(), 0);
        await page.screenshot({ path: `${output}/login-${viewport.width}.png`, fullPage: true });
      }
      results.push({ viewport: viewport.width, path, status: response.status() });
    }
    await page.goto(`${origin}/admin/login`, { waitUntil: "networkidle" });
    await page.locator('input[name="phone"]').fill(phone);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL(`${origin}/admin`, { timeout: 15000 });
    await page.goto(`${origin}/admin/ingredients/extras`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Добавить допы в каталог|Добавить к новым блюдам/ }).click();
    await page.waitForURL(/saved=/);
    assert.equal(await page.locator("article").count(), 20);
    assert.match(await page.locator("article").filter({ hasText: "Халапеньо" }).innerText(), /Данные уточняются/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${output}/extras-${viewport.width}.png`, fullPage: true });
    for (const path of ["/admin/analytics/planning", "/admin/notifications", "/admin/analytics", "/admin/economics", "/admin/customers", "/admin/orders", "/pos", "/kitchen"]) {
      const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, path);
      assert.equal(page.url(), `${origin}${path}`, `authentication ${path}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${path}`);
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(body, /Application error|Временно не удалось построить план/);
      if (path === "/admin/analytics/planning") {
        assert.match(body, /Капуста для проверки/);
        assert.match(body, /Бургер для проверки/);
        await page.screenshot({ path: `${output}/planning-${viewport.width}.png`, fullPage: true });
        await page.locator('select[name="days"]').selectOption("14");
        await page.getByRole("button", { name: "Рассчитать" }).click();
        await page.waitForURL(/days=14/);
        assert.equal(await page.locator('select[name="days"]').inputValue(), "14");
      }
      if (path === "/admin/notifications") {
        assert.match(body, /Выключена/);
        assert.doesNotMatch(body, /Схема очереди недоступна|Очередь недоступна/);
        await page.screenshot({ path: `${output}/notifications-${viewport.width}.png`, fullPage: true });
      }
      results.push({ viewport: viewport.width, path, status: response.status() });
    }
    const guestName = `Проверка кухни ${viewport.width}`;
    await sql`update inventory_items set current_quantity = 0, reserved_quantity = 0`;
    await page.goto(`${origin}/pos`, { waitUntil: "networkidle" });
    await page.locator("article").filter({ hasText: "Бургер для проверки" }).getByRole("button", { name: /Добавить/ }).click();
    await page.locator('input[name="customer_name"]').fill(guestName);
    await page.getByRole("button", { name: "Отправить на кухню", exact: true }).click();
    await page.waitForFunction(() => /Заказ .+ отправлен на кухню/.test(document.body.innerText));
    const [created] = await sql`select display_number from orders where customer_name = ${guestName} and is_test order by created_at desc limit 1`;
    assert.ok(created?.display_number);
    await page.goto(`${origin}/kitchen`, { waitUntil: "networkidle" });
    const ticket = page.locator("article").filter({ hasText: created.display_number });
    await ticket.waitFor();
    assert.match(await ticket.getAttribute("class"), /border-red-500/);
    assert.equal(await ticket.getByRole("button", { name: "Принять", exact: true }).count(), 0);
    for (const [button, color] of [["Начать готовить", "border-amber-400"], ["Готово", "border-emerald-500"]]) {
      await ticket.getByRole("button", { name: button, exact: true }).click();
      await page.waitForFunction(({ name, color }) => [...document.querySelectorAll("article")].some(element => element.textContent.includes(name) && element.className.includes(color)), { name: created.display_number, color });
      await page.screenshot({ path: `${output}/kitchen-${color}-${viewport.width}.png`, fullPage: true });
    }
    await ticket.getByRole("button", { name: "Выдан", exact: true }).click();
    await ticket.waitFor({ state: "detached" });
    await page.goto(`${origin}/admin/orders?view=history`, { waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), new RegExp(guestName));
    assert.deepEqual(exceptions, [], "browser exceptions");
    await page.goto(`${origin}/admin`, { waitUntil: "networkidle" });
    if (viewport.width < 768) await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(`${origin}/admin/login`);
    await page.goto(`${origin}/admin/notifications`, { waitUntil: "networkidle" });
    assert.equal(page.url(), `${origin}/admin/login`, "logout revokes access");
    await context.close();
  }
  writeFileSync(`${output}/browser-smoke.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ status: "passed", pageChecks: results.length, screenshots: output, origin, fixtureOnly: true }));
} finally {
  await browser?.close();
  await sql.end();
}
