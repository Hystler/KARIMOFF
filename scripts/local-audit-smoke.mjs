import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import ts from "typescript";
import sharp from "sharp";
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
  const [snack] = await sql`update products
    set description='Куриные наггетсы в хрустящей панировке. Выберите порцию к своему заказу.',
        image_url='/assets/products/snacks/naggetsy-6-sht.webp',is_active=true
    where slug='naggetsy-6-sht' returning id`;
  assert.ok(snack?.id, 'fixture catalog must contain nuggets');
  let [nugget] = await sql`select id from ingredients where name='Наггетсы'`;
  if (!nugget) [nugget] = await sql`insert into ingredients(name,unit,cost_per_unit) values('Наггетсы','pcs',14.4) returning id`;
  await sql`update ingredients set unit='pcs',nutrition_basis_quantity=1,calories_kcal=50,proteins_g=2,fats_g=3,carbohydrates_g=4 where id=${nugget.id}`;
  await sql`delete from product_ingredients where product_id=${snack.id}`;
  await sql`insert into product_ingredients(product_id,ingredient_id,quantity,unit) values(${snack.id},${nugget.id},6,'pcs')`;
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
  const [customer] = await sql`insert into customers(name,phone) values('Тест интерфейса', '+79990000123')
    on conflict(phone) do update set name=excluded.name returning id`;
  const customerToken = randomBytes(32).toString('base64url');
  await sql`insert into app_sessions(subject_type,subject_id,token_hash,expires_at)
    values('customer',${customer.id},${createHmac('sha256',environment.SESSION_SECRET).update(customerToken).digest('hex')},now()+interval '1 hour')`;
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
    await page.goto(`${origin}/admin/products/${snack.id}/edit`, { waitUntil: "networkidle" });
    await page.getByRole('button',{name:'Сохранить порции',exact:true}).click();
    await page.waitForURL(/saved=portions/);
    await page.goto(`${origin}/menu/naggetsy-6-sht`, { waitUntil: "networkidle" });
    const addSnack=page.locator('button.public-button-primary').filter({hasText:/Добавить в корзину|Выберите порцию/});
    assert.equal(await addSnack.isDisabled(),true,'portion required');
    await page.getByRole('button',{name:'6 шт. 210 ₽',exact:true}).click();
    assert.match(await addSnack.innerText(),/210/);
    assert.match(await page.locator('section[aria-label="Пищевая ценность выбранного блюда"]').innerText(),/300 ккал/);
    await page.getByRole('button',{name:'12 шт. 390 ₽',exact:true}).click();
    assert.match(await addSnack.innerText(),/390/);
    assert.match(await page.locator('section[aria-label="Пищевая ценность выбранного блюда"]').innerText(),/600 ккал/);
    const optionalExtras=page.locator('details').filter({hasText:'Допы KARIMOFF'});
    assert.equal(await optionalExtras.getAttribute('open'),null,'optional extras initially collapsed');
    await optionalExtras.locator('summary').click();
    const friesOption=optionalExtras.getByRole('button',{name:/Картофель фри/});
    await friesOption.click();
    assert.match(await addSnack.innerText(),/430/);
    assert.match(await optionalExtras.locator('summary').innerText(),/Выбрано: 1/);
    assert.match(await page.locator('section[aria-label="Пищевая ценность выбранного блюда"]').innerText(),/Данные уточняются/);
    await friesOption.click();
    await optionalExtras.locator('summary').click();
    assert.match(await addSnack.innerText(),/390/);
    await addSnack.click();
    await page.getByRole('button',{name:/Открыть корзину/}).first().click();
    assert.match(await page.getByRole('dialog').innerText(),/12 шт\./);
    await page.reload({waitUntil:'networkidle'});
    assert.match(await page.evaluate(()=>localStorage.getItem('karimoff_cart_v3') || Object.entries(localStorage).filter(([key])=>key.includes('cart')).map(([,value])=>value).join('')),/390|180/);
    await page.keyboard.press('Escape');
    for (const theme of ['light','dark']) {
      await page.emulateMedia({colorScheme:theme});
      await page.evaluate(theme=>{localStorage.setItem('karimoff_theme_preference_v2',theme);},theme);
      for(const path of ['/menu','/menu/naggetsy-6-sht']) {
        await page.goto(origin+path,{waitUntil:'networkidle'});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${path} ${theme}`);
        if(path==='/menu') {
          const cards=page.locator('.product-card');
          const dimensions=await cards.evaluateAll(nodes=>nodes.map(node=>({height:node.offsetHeight,top:node.offsetTop})));
          await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
          await page.waitForTimeout(250);
          await page.evaluate(()=>scrollTo(0,0));
          assert.deepEqual(await cards.evaluateAll(nodes=>nodes.map(node=>({height:node.offsetHeight,top:node.offsetTop}))),dimensions,'menu geometry remains stable after scroll');
        }
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:`${output}/${path==='/menu'?'menu':'portions'}-${theme}-${viewport.width}.png`,fullPage:true});
        results.push({viewport:viewport.width,path,theme,status:200});
      }
    }
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
    await context.addCookies([{name:'karimoff_customer_session',value:customerToken,url:origin,httpOnly:true,sameSite:'Lax'}]);
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>localStorage.setItem('karimoff_theme_preference_v2',theme),theme);
      for(const path of ['/profile','/profile/avatar']) {
        const response=await page.goto(origin+path,{waitUntil:'networkidle'});
        assert.equal(response.status(),200);
        assert.equal(new URL(page.url()).pathname,path,'fixture customer session readback');
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${path} ${theme}`);
        if(path.endsWith('avatar')) {
          for(const section of ['Типаж','Взгляд','Характер','Аксессуар','Образ','Сцена']) {
            const button=page.getByRole('button',{name:section,exact:true});
            await button.click();
            assert.equal(await button.getAttribute('aria-pressed'),'true');
          }
          const firstOption=page.locator('.avatar-option').first();
          await firstOption.click();
          assert.equal(await firstOption.getAttribute('aria-pressed'),'true');
          const selection=await page.locator('.avatar-editor input[type="hidden"]').evaluateAll(inputs=>inputs.map(input=>[input.name,input.value]));
          for(const switched of [theme==='dark'?'light':'dark',theme]) {
            await page.getByRole('button',{name:switched==='dark'?'Включить ночную тему':'Включить дневную тему',exact:true}).click();
            await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,switched);
            assert.deepEqual(await page.locator('.avatar-editor input[type="hidden"]').evaluateAll(inputs=>inputs.map(input=>[input.name,input.value])),selection,'theme toggle preserves avatar choices');
          }
          assert.equal(await page.locator('.avatar-editor-footer').evaluate(element=>getComputedStyle(element).position),'static','save action does not cover avatar options');
          const canvas=page.locator('canvas').first();
          await canvas.scrollIntoViewIfNeeded();
          const pixels=await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer();
          assert.ok(new Set(pixels).size>32,'avatar canvas is nonblank');
          const before=await canvas.screenshot();
          await page.waitForTimeout(500);
          const after=await canvas.screenshot();
          assert.equal(before.equals(after),false,'avatar scene is moving');
        }
        await page.evaluate(()=>scrollTo(0,0));
        await page.waitForTimeout(250);
        await page.screenshot({path:`${output}/${path.endsWith('avatar')?'avatar':'profile'}-${theme}-${viewport.width}.png`,fullPage:true});
        results.push({viewport:viewport.width,path,theme,status:200});
      }
    }
    assert.deepEqual(exceptions, [], "browser exceptions including profile");
    await context.close();
  }
  writeFileSync(`${output}/browser-smoke.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ status: "passed", pageChecks: results.length, screenshots: output, origin, fixtureOnly: true }));
} finally {
  await browser?.close();
  await sql`update products set is_active=false where slug='audit-burger' or category='Напитки'`;
  await sql`update ingredients set calories_kcal=null,proteins_g=null,fats_g=null,carbohydrates_g=null where name='Наггетсы'`;
  await sql.end();
}
