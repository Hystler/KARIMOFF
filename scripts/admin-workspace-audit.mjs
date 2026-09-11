import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import postgres from "postgres";

// Deliberately fixed: this audit may never target an environment-provided database or server.
assert.ok(process.argv.includes("--disposable-audit"), "Pass --disposable-audit to allow synthetic local mutations");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dsn = "postgres://postgres@127.0.0.1:55440/karimoff_audit";
const origin = "http://127.0.0.1:3109";
const runId = new Date().toISOString().replaceAll(":", "-");
const output = join(root, "outputs/admin-ui-audit", runId);
mkdirSync(output, { recursive: true });
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
assert.ok(modulePath, "Set PLAYWRIGHT_MODULE_PATH to an installed Playwright module");
const playwrightModule = await import(pathToFileURL(resolve(modulePath)).href);
const { chromium } = playwrightModule.default ?? playwrightModule;
const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice() {} });
const phone = `+7999${randomInt(1000000, 9999999)}`;
const password = randomBytes(24).toString("base64url");
const secret = randomBytes(32).toString("hex");
const routes = [
  ["overview", "/admin"], ["ingredients", "/admin/ingredients"],
  ["extras", "/admin/ingredients/extras"], ["inventory", "/admin/inventory"],
  ["production", "/admin/production"], ["customers", "/admin/customers"],
  ["economics", "/admin/economics"], ["analytics-overview", "/admin/analytics"],
  ["analytics-sales", "/admin/analytics/sales"], ["analytics-audience", "/admin/analytics/audience"],
  ["loyalty", "/admin/loyalty"], ["leads", "/admin/leads"],
  ["vacancies", "/admin/vacancies"], ["staff", "/admin/staff"],
  ["staff-percent-error", "/admin/staff?error=100%25"],
  ["settings", "/admin/settings"], ["notifications", "/admin/notifications"],
  ["orders", "/admin/orders"], ["prices", "/admin/ingredients/prices"],
  ["pos", "/pos"], ["kitchen", "/kitchen"], ["admin-kitchen", "/admin/kitchen"]
];
const viewports = [
  { width: 1440, height: 900, deviceScaleFactor: 1, label: "1440x900-100pct" },
  { width: 1152, height: 720, deviceScaleFactor: 1.25, label: "1152x720-125pct-equivalent" },
  { width: 1800, height: 1125, deviceScaleFactor: 0.8, label: "1800x1125-80pct-equivalent" },
  { width: 390, height: 844, deviceScaleFactor: 1, label: "390x844-mobile" }
];
const selectedRoutes = process.env.AUDIT_ROUTE_FILTER ? routes.filter(([name]) => process.env.AUDIT_ROUTE_FILTER.split(",").includes(name)) : routes;
const selectedViewports = process.env.AUDIT_VIEWPORT_FILTER ? viewports.filter(({ width }) => process.env.AUDIT_VIEWPORT_FILTER.split(",").includes(String(width))) : viewports;
const report = { runId, origin, dsn, output, fixtureOnly: true, zoomMethod: "CSS viewport divided/multiplied with deviceScaleFactor; not browser native zoom", pages: [], assertions: [], fixtureOrders: [], browserErrors: [], blockedExternal: [], fatal: null };
let browser;
let dev;
let context;
let page;
let product;
let snack;
let recipeId;
let outputIngredient;
let rawIngredient;

function record(name, passed, detail = {}) {
  report.assertions.push({ name, passed, ...detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

function saveReport() {
  writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const failures = report.assertions.filter(item => !item.passed);
  const body = ["# Admin Workspace Browser Audit", "", `Run: ${runId}`, `Local only: ${origin}; ${dsn}`, "Zoom: CSS viewport + device scale factor equivalent, not native browser zoom.", "",
    `${report.pages.length} page captures; ${report.assertions.length - failures.length}/${report.assertions.length} assertions passed.`,
    "", "## Failures", ...failures.map(item => `- ${item.name}: ${JSON.stringify(item)}`),
    "", "## Pages", "| Route | Viewport | HTTP | Overflow | Clipping candidates | Screenshot |", "|---|---|---|---|---|---|",
    ...report.pages.map(item => `| ${item.path} | ${item.viewport} | ${item.status} | ${item.layout?.overflow ?? "unknown"} | ${item.layout?.clippedControls.length ?? "unknown"} | [image](${item.screenshot}) |`),
    "", "## Browser Errors", ...report.browserErrors.map(item => `- ${JSON.stringify(item)}`),
    "", report.fatal ? `Fatal: ${report.fatal}` : "Server and browser are stopped in finally."
  ].join("\n");
  writeFileSync(join(output, "report.md"), `${body}\n`);
  writeFileSync(join(root, "outputs/admin-ui-audit/latest.json"), `${JSON.stringify({ runId, output, report: join(output, "report.json") }, null, 2)}\n`);
}

async function stop() {
  await browser?.close().catch(() => {});
  if (dev && dev.exitCode === null) {
    try { process.kill(-dev.pid, "SIGTERM"); } catch { dev.kill("SIGTERM"); }
    await Promise.race([new Promise(done => dev.once("exit", done)), new Promise(done => setTimeout(done, 5000))]);
    try { process.kill(-dev.pid, "SIGKILL"); } catch { /* Process group already stopped. */ }
  }
  await sql.end({ timeout: 5 });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop().finally(() => process.exit(130)); });

async function goto(path) {
  const response = await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const cookie = page.getByRole("button", { name: "Только необходимые", exact: true });
  if (await cookie.isVisible()) await cookie.click();
  return response;
}

async function layout() {
  return page.evaluate(() => {
    const clippedControls = [];
    const intentionalScroll = [];
    const selector = element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.getAttribute("name") ? `[name=${element.getAttribute("name")}]` : ""}`;
    for (const element of document.querySelectorAll("button,input:not([type=hidden]),select,textarea,a")) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 1 || rect.height < 1 || rect.right <= 0 || style.visibility === "hidden" || element.closest("nextjs-portal,[hidden],[inert],[aria-hidden=true]")) continue;
      if (element.closest("details:not([open])") && !element.closest("summary")) continue;
      let scrollContainer = null;
      let clippedBy = null;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const s = getComputedStyle(parent);
        const r = parent.getBoundingClientRect();
        if (["auto", "scroll"].includes(s.overflowX) && parent.scrollWidth > parent.clientWidth + 2) scrollContainer = selector(parent);
        if (["hidden", "clip"].includes(s.overflowX) && (rect.left < r.left - 2 || rect.right > r.right + 2)) clippedBy = selector(parent);
      }
      const label = (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.textContent || element.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 100);
      if (scrollContainer) { intentionalScroll.push({ element: selector(element), label, scrollContainer }); continue; }
      if (rect.left < -2 || rect.right > innerWidth + 2 || clippedBy) clippedControls.push({ element: selector(element), label, left: Math.round(rect.left), right: Math.round(rect.right), clippedBy });
    }
    const brokenImages = [...document.images].filter(img => img.complete && !img.naturalWidth).map(img => ({ alt: img.alt, src: img.getAttribute("src")?.slice(0, 160) }));
    const overflowElements = [...document.querySelectorAll("main *,form *")].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 2 && rect.width > 2;
    }).slice(0, 20).map(element => ({ element: selector(element), className: typeof element.className === "string" ? element.className : "svg", right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width), overflowX: getComputedStyle(element).overflowX }));
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 2, clippedControls, intentionalScrollCount: intentionalScroll.length, brokenImages, overflowElements };
  });
}

async function capture(name, path, viewport, navigate = true) {
  const errorStart = report.browserErrors.length;
  let response;
  try {
    if (navigate) response = await goto(path);
    await page.evaluate(() => scrollTo(0, 0));
    const measured = await layout();
    const screenshot = join(output, `${name}-${viewport.label}.png`);
    await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled" });
    const text = await page.locator("body").innerText();
    const entry = { name, path, viewport: viewport.label, status: response?.status() ?? 200, finalPath: new URL(page.url()).pathname, layout: measured, screenshot, pageErrorCount: report.browserErrors.length - errorStart };
    report.pages.push(entry);
    record(`${name} ${viewport.label}: status/access`, entry.status === 200 && entry.finalPath === path.split("?")[0], { status: entry.status, finalPath: entry.finalPath });
    record(`${name} ${viewport.label}: document overflow`, !measured.overflow, { scrollWidth: measured.scrollWidth });
    record(`${name} ${viewport.label}: runtime render`, !/Application error|Internal Server Error|Runtime Error|Ошибка загрузки страницы/.test(text) && !entry.pageErrorCount);
    if (name === "staff-percent-error") record(`${name} ${viewport.label}: decoded once`, text.includes("100%") && !text.includes("URIError"));
    if (measured.clippedControls.length) console.log(`CLIPPING ${path} ${viewport.label}: ${JSON.stringify(measured.clippedControls.slice(0, 4))}`);
    writeFileSync(join(output, `${name}-${viewport.label}.txt`), text);
    saveReport();
  } catch (error) {
    record(`${name} ${viewport.label}: navigation/capture`, false, { error: error.message });
    saveReport();
  }
}

async function action(name, callback) {
  try { await callback(); record(name, true); }
  catch (error) {
    record(name, false, { error: error.message });
    await page.screenshot({ path: join(output, `failure-${name.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: true }).catch(() => {});
  }
  saveReport();
}

try {
  const dockerContext = execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim();
  const endpoint = execFileSync("docker", ["context", "inspect", dockerContext, "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  assert.ok(endpoint.startsWith("unix://"), "Only a local Docker daemon is allowed");
  const container = JSON.parse(execFileSync("docker", ["inspect", "karimoff-audit-20260911"], { encoding: "utf8" }))[0];
  assert.equal(container.Config.Labels["karimoff.local-audit"], "20260911");
  assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "55440" }]);
  const [identity] = await sql`select current_database() as name, to_regclass('local_audit.applied_migrations') is not null as owned`;
  assert.equal(identity.name, "karimoff_audit");
  assert.ok(identity.owned);
  await new Promise((done, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error("Port 3109 is occupied; refusing to touch another server")));
    server.listen(3109, "127.0.0.1", () => server.close(done));
  });
  [product] = await sql`select id,name,slug from products where is_active and category='Бургеры' order by sort_order limit 1`;
  [snack] = await sql`select id,name,slug from products where is_active and category='Горячие закуски' order by sort_order limit 1`;
  const [location] = await sql`select id from order_locations where is_active order by is_default desc limit 1`;
  assert.ok(product && snack && location, "Seeded catalog required");
  async function itemFor(p, quantity) {
    const options = await sql`select id from (select o.id,g.min_selections,row_number() over(partition by g.id order by o.sort_order,o.id) as n from product_modifier_groups g join product_modifier_options o on o.group_id=g.id where g.product_id=${p.id} and g.is_active and g.min_selections>0 and o.is_active) required where n<=min_selections`;
    return { product_id: p.id, quantity, modifier_option_ids: options.map(option => option.id) };
  }
  // Retain old audit records, but keep reruns at nine active fixture tickets.
  await sql`update orders set is_operational=false where comment='Disposable local browser audit' or customer_name like 'UI browser %'`;
  for (let index = 0; index < 9; index++) {
    const items = index % 3 === 0 ? [await itemFor(product, 1)] : index % 3 === 1 ? [await itemFor(snack, 2)] : [await itemFor(product, 2), await itemFor(snack, 1)];
    const [order] = await sql`select * from create_pos_order_atomic(${location.id}::uuid,${`UI audit ${runId.slice(11, 19)} #${index + 1}`}::text,
      'Disposable local browser audit'::text,${sql.json(items)}::jsonb,${randomUUID()}::uuid,null::uuid,'owner'::text,'asap'::text,null::timestamptz,false,null::uuid)`;
    report.fixtureOrders.push({ ...order, items });
  }
  const seeded = await sql`select id,is_test,source from orders where id in ${sql(report.fixtureOrders.map(order => order.order_id))}`;
  record("nine non-test POS fixtures created atomically", seeded.length === 9 && seeded.every(order => order.is_test === false && order.source === "pos"));
  [rawIngredient] = await sql`select id from ingredients where is_active and unit='g' order by sort_order limit 1`;
  [outputIngredient] = await sql`insert into ingredients(name,category,unit,cost_per_unit,sort_order,is_active)
    values(${`UI audit output ${runId}`},'UI audit','g',0.3,0,true) returning id`;
  const components = [{ ingredient_id: rawIngredient.id, quantity: 1.2, unit: "kg", is_primary: true, sort_order: 100 }];
  const expenses = [{ name: "Fixture labor", category: "labor", amount_per_batch: 120, sort_order: 100 }];
  const [recipe] = await sql`select save_production_recipe_atomic(null::uuid,${`UI audit recipe ${runId}`}::text,
    ${outputIngredient.id}::uuid,'UI audit'::text,1::numeric,'kg'::text,45::integer,20::numeric,650::numeric,
    'Disposable local fixture'::text,true,0::integer,${sql.json(components)}::jsonb,${sql.json(expenses)}::jsonb) as id`;
  recipeId = recipe.id;
  report.fixtureRecipe = recipeId;
  await sql`insert into inventory_items(ingredient_id,unit,current_quantity,reserved_quantity,min_quantity) values(${outputIngredient.id},'g',1000,0,200)`;
  for (const [unit, suffix] of [["pcs", "missing piece mass"], ["ml", "missing density"]]) {
    await sql`insert into ingredients(name,category,unit,cost_per_unit,sort_order,is_active,nutrition_basis_quantity,calories_kcal,proteins_g,fats_g,carbohydrates_g)
      values(${`UI audit ${suffix} ${runId}`},'UI audit',${unit},1,1,true,1,10,1,0,1)`;
  }
  if (!process.env.AUDIT_ROUTE_FILTER) selectedRoutes.push(["production-new", "/admin/production/new"], ["production-edit", `/admin/production/${recipeId}/edit`], ["ingredient-edit", `/admin/ingredients/${outputIngredient.id}/edit`]);

  // Empty all repository-configured names before Next loads .env files. No provider secrets are inherited.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG };
  const names = new Set();
  for (const filename of [".env", ".env.local", ".env.development", ".env.development.local", ".env.example"]) {
    if (!existsSync(join(root, filename))) continue;
    for (const line of readFileSync(join(root, filename), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) names.add(match[1]);
    }
  }
  for (const name of names) env[name] = "";
  Object.assign(env, {
    NODE_ENV: "development", DATABASE_URL: dsn, APP_ORIGIN: origin, NEXT_PUBLIC_APP_URL: origin,
    ADMIN_PHONE: phone, ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 12), SESSION_SECRET: secret,
    TEST_ORDER_MODE: "false", PAYMENTS_ENABLED: "false", EVOTOR_ENABLED: "false", EVOTOR_BACKGROUND_SYNC: "false",
    ORDER_STATUS_NOTIFICATIONS_ENABLED: "false", RUNTIME_MIGRATIONS_READ_ONLY: "true", NEXT_TELEMETRY_DISABLED: "1"
  });
  dev = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3109"], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = chunk => appendFileSync(join(output, "dev-server.log"), chunk.toString().replaceAll(password, "[redacted]").replaceAll(secret, "[redacted]").replaceAll(phone, "[synthetic-phone]"));
  dev.stdout.on("data", log);
  dev.stderr.on("data", log);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (dev.exitCode !== null) throw new Error(`Dev server exited ${dev.exitCode}; see dev-server.log`);
    ready = await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false);
    if (ready) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, "Dev server did not become ready");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  let authState;
  for (const viewport of selectedViewports) {
    context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor, locale: "ru-RU", extraHTTPHeaders: { "x-forwarded-proto": "http" }, ...(authState ? { storageState: authState } : {}) });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      report.blockedExternal.push({ origin: url.origin, type: route.request().resourceType() });
      return route.abort("blockedbyclient");
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.browserErrors.push({ path: new URL(page.url()).pathname, viewport: viewport.label, type: "pageerror", message: error.message }));
    page.on("console", message => { if (message.type() === "error") appendFileSync(join(output, "console-errors.log"), `${viewport.label} ${page.url()} ${message.text()}\n`); });
    if (!authState) {
      for (const [name, path] of selectedRoutes) {
        const response = await context.request.get(origin + path, { maxRedirects: 0 });
        let protectedRoute = [302, 303, 307, 308].includes(response.status()) && response.headers().location?.includes("/admin/login");
        if (response.status() === 200) {
          await goto(path);
          await page.waitForURL(/\/admin\/login/, { timeout: 10000 }).catch(() => {});
          protectedRoute = new URL(page.url()).pathname === "/admin/login";
        }
        record(`unauthenticated ${name} redirects`, Boolean(protectedRoute), { status: response.status(), streamingRedirect: response.status() === 200 });
      }
      for (const [path, method, accepted] of [["/api/admin/analytics/performance", "GET", [404]], ["/api/admin/analytics/sales/export", "GET", [401, 403]], ["/api/admin/loyalty/card/resolve", "POST", [401, 403]]]) {
        const response = await context.request.fetch(origin + path, { method, maxRedirects: 0, headers: { Origin: origin }, ...(method === "POST" ? { data: { value: "local-audit-invalid-card" } } : {}) });
        record(`unauthenticated API ${path}`, accepted.includes(response.status()), { status: response.status(), method });
      }
      await goto("/admin/login");
      await page.locator('input[name="phone"]').fill(phone);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page.waitForURL(origin + "/admin", { timeout: 30000 });
      record("admin authentication through login form", true);
      authState = await context.storageState();
      if (!process.env.AUDIT_ROUTE_FILTER || process.env.AUDIT_ROUTE_FILTER.split(",").includes("extras")) await action("extras catalog install and price persist", async () => {
        await goto("/admin/ingredients/extras");
        await page.getByRole("button", { name: /Добавить допы в каталог|Добавить к новым блюдам/ }).click();
        await page.waitForURL(/saved=/);
        assert.ok(await page.locator("tbody tr").count() >= 3);
        const row = page.locator("tbody tr").first();
        const ingredientId = await row.locator('[name="ingredient_id"]').inputValue();
        const price = Number(await row.locator('[name="price"]').inputValue()) + 1;
        await row.locator('[name="price"]').fill(String(price));
        await row.locator('button[type="submit"]').click();
        await page.waitForTimeout(700);
        const updated = await sql`select distinct extra_price from product_ingredients where ingredient_id=${ingredientId} and is_extra_available`;
        assert.ok(updated.length > 0);
        assert.ok(updated.every(item => Number(item.extra_price) === price));
        await goto("/admin/ingredients/extras");
        assert.equal(await page.locator("tbody tr").first().locator('[name="price"]').inputValue(), String(price));
      });
    }
    for (const [name, path] of selectedRoutes) await capture(name, path, viewport);
    if (viewport === selectedViewports[0]) {
      await action("admin dark theme survives a hard reload without a light transition", async () => {
        await goto("/admin");
        await page.evaluate(() => localStorage.setItem("karimoff_theme_preference_v2", "dark"));
        await page.addInitScript(() => {
          window.__karimoffThemeTransitions = [];
          const record = () => window.__karimoffThemeTransitions.push(document.documentElement?.getAttribute("data-theme") ?? "unset");
          const observeTheme = () => {
            if (!document.documentElement) return;
            record();
            new MutationObserver(record).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
          };
          if (document.documentElement) observeTheme();
          else document.addEventListener("DOMContentLoaded", observeTheme, { once: true });
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
        const transitions = await page.evaluate(() => window.__karimoffThemeTransitions);
        assert.equal(transitions.includes("light"), false, `Unexpected theme transitions: ${transitions.join(", ")}`);
        for (const [name, path] of [["overview", "/admin"], ["economics", "/admin/economics"], ["analytics", "/admin/analytics"], ["notifications", "/admin/notifications"], ["pos", "/pos"]]) {
          if (path !== "/admin") await goto(path);
          assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark", `${path} lost the dark theme`);
          assert.equal((await layout()).overflow, false, `${path} overflowed in the dark theme`);
          const routeTransitions = await page.evaluate(() => window.__karimoffThemeTransitions);
          assert.equal(routeTransitions.includes("light"), false, `${path} flashed light: ${routeTransitions.join(", ")}`);
          await page.screenshot({ path: join(output, `${name}-dark-${viewport.label}.png`), fullPage: false, animations: "disabled" });
        }
        await goto("/admin");
        await page.getByRole("button", { name: "Включить светлую тему" }).first().click();
        assert.equal(await page.evaluate(() => localStorage.getItem("karimoff_theme_preference_v2")), "light");
      });
    }
    if (!process.env.AUDIT_ROUTE_FILTER) {
    await action(`filled production screenshots ${viewport.label}`, async () => {
      await goto("/admin/production/new");
      await page.locator('[name="name"]').fill("Fixture new production card");
      await page.locator('[name="output_ingredient_id"]').selectOption(outputIngredient.id);
      await page.locator('[name="output_quantity"]').fill("1");
      await page.locator('[name="batch_duration_minutes"]').fill("45");
      await page.locator('[name="planned_batches_per_month"]').fill("20");
      await page.locator('[name="sale_price_per_output_unit"]').fill("650");
      const firstComponent = page.getByRole("region", { name: "Состав партии", exact: true }).locator("tbody tr").first();
      if (await firstComponent.count() === 0) await page.getByRole("button", { name: "Добавить сырьё", exact: true }).click();
      await firstComponent.locator("select").first().selectOption(rawIngredient.id);
      await firstComponent.locator('input[type="number"]').fill("1.2");
      await capture("production-new-filled", "/admin/production/new", viewport, false);
      await page.screenshot({ path: join(output, `production-new-filled-${viewport.label}-full.png`), fullPage: true });
      await goto(`/admin/production/${recipeId}/edit`);
      await page.screenshot({ path: join(output, `production-edit-${viewport.label}-full.png`), fullPage: true });
    });
    await action(`inventory edit screenshot ${viewport.label}`, async () => {
      await goto("/admin/inventory");
      await page.getByRole("button", { name: `Корректировка: UI audit output ${runId}`, exact: true }).click();
      await page.locator('#correction [name="new_quantity"]').fill("1200");
      await capture("inventory-edit", "/admin/inventory", viewport, false);
    });
    await action(`ingredient mass statuses ${viewport.label}`, async () => {
      await goto("/admin/ingredients");
      const body = await page.locator("body").innerText();
      assert.match(body, /Нет массы 1 шт\./);
      assert.match(body, /Нет плотности, г\/мл/);
      await page.screenshot({ path: join(output, `ingredient-mass-statuses-${viewport.label}.png`), fullPage: false });
    });
    }
    if (!process.env.AUDIT_ROUTE_FILTER) {
      await capture("public-menu", "/menu", viewport);
      await capture("public-product", `/menu/${product.slug}`, viewport);
      await action(`public cart ${viewport.label}`, async () => {
        const add = page.getByRole("button", { name: /Добавить в корзину/ }).last();
        await add.click();
        await page.getByRole("button", { name: /Открыть корзину/ }).first().click();
        assert.match(await page.getByRole("dialog").innerText(), new RegExp(product.name));
        await capture("public-cart", `/menu/${product.slug}`, viewport, false);
        await page.keyboard.press("Escape");
        await page.reload({ waitUntil: "domcontentloaded" });
        assert.ok(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.includes("cart") && value.includes('product'))), "Cart persists after reload");
      });
    }
    if (viewport === selectedViewports[0] && !process.env.AUDIT_ROUTE_FILTER) {
      await action("ingredient create and persisted edit", async () => {
        await goto("/admin/ingredients/new");
        const name = `UI audit ingredient ${runId}`;
        await page.locator('[name="name"]').fill(name);
        await page.locator('[name="package_size"]').fill("1000");
        await page.locator('[name="package_price"]').fill("250");
        await page.getByRole("button", { name: "Создать ингредиент", exact: true }).click();
        await page.waitForURL(url => !url.pathname.endsWith("/new"));
        const [ingredient] = await sql`select id,cost_per_unit from ingredients where name=${name}`;
        assert.equal(Number(ingredient.cost_per_unit), 0.25);
        await goto(`/admin/ingredients/${ingredient.id}/edit`);
        await page.locator('[name="package_price"]').fill("300");
        await page.getByRole("button", { name: /Сохранить/ }).last().click();
        await page.waitForURL(url => !url.pathname.endsWith("/edit") || url.search.includes("saved"));
        const [updated] = await sql`select cost_per_unit from ingredients where id=${ingredient.id}`;
        assert.equal(Number(updated.cost_per_unit), 0.3);
        report.fixtureIngredient = ingredient.id;
      });
      await action("production create and edit persisted", async () => {
        assert.ok(report.fixtureIngredient, "Ingredient fixture creation must succeed first");
        await goto("/admin/production/new");
        const name = `UI browser recipe ${runId}`;
        await page.locator('[name="name"]').fill(name);
        await page.locator('[name="output_ingredient_id"]').selectOption(report.fixtureIngredient);
        const component = page.getByRole("region", { name: "Состав партии", exact: true }).locator("tbody tr").first();
        await component.locator("select").first().selectOption(rawIngredient.id);
        await component.locator('input[type="number"]').fill("1.2");
        await page.getByRole("button", { name: "Создать карту", exact: true }).click();
        await page.waitForURL(url => url.searchParams.has("saved") && !url.searchParams.has("error"));
        const [recipe] = await sql`select id from production_recipes where name=${name}`;
        assert.ok(recipe);
        await goto(`/admin/production/${recipe.id}/edit`);
        await page.locator('[name="sale_price_per_output_unit"]').fill("700");
        await page.getByRole("button", { name: "Сохранить карту", exact: true }).click();
        await page.waitForURL(url => url.searchParams.has("saved") && !url.searchParams.has("error"));
        const [updated] = await sql`select sale_price_per_output_unit from production_recipes where id=${recipe.id}`;
        assert.equal(Number(updated.sale_price_per_output_unit), 700);
      });
      await action("inventory receipt correction and write-off", async () => {
        const [stock] = await sql`select ingredient_id,current_quantity from inventory_items order by created_at limit 1`;
        assert.ok(stock);
        for (const [operation, value, expected] of [["receipt", 10, Number(stock.current_quantity) + 10], ["correction", 100, 100], ["write-off", 5, 95]]) {
          await goto("/admin/inventory");
          await page.locator("summary").filter({ hasText: "Складская операция" }).click();
          const label = { receipt: "Приход", correction: "Корректировка", "write-off": "Списание" }[operation];
          await page.getByRole("button", { name: label, exact: true }).click();
          const form = page.locator(`#${operation}`);
          await form.locator('[name="ingredient_id"]').selectOption(stock.ingredient_id);
          await form.locator('input[type="number"]').first().fill(String(value));
          await form.locator('button[type="submit"]').click();
          await page.waitForURL(/saved=1/);
          const [current] = await sql`select current_quantity from inventory_items where ingredient_id=${stock.ingredient_id}`;
          assert.equal(Number(current.current_quantity), expected);
        }
      });
      await action("staff creation and disable", async () => {
        await goto("/admin/staff");
        const disclosure = page.locator("details:not([open]) summary").filter({ hasText: "Добавить сотрудника" });
        if (await disclosure.count()) await disclosure.click();
        const name = `UI audit staff ${runId}`;
        await page.locator('[name="name"]').fill(name);
        await page.locator('[name="phone"]').fill(`+7998${randomInt(1000000, 9999999)}`);
        await page.locator('[name="password"]').fill(randomBytes(18).toString("base64url"));
        await page.getByRole("button", { name: "Добавить сотрудника", exact: true }).click();
        await page.waitForURL(/saved=/);
        const card = page.locator("tr,article").filter({ hasText: name });
        await card.getByRole("button", { name: "Отключить", exact: true }).click();
        await page.waitForTimeout(500);
        const [staff] = await sql`select is_active from staff_users where name=${name}`;
        assert.equal(staff.is_active, false);
      });
      await action("POS order UI to database", async () => {
        await goto("/pos");
        await page.getByPlaceholder("Найти позицию").fill(product.name);
        await page.locator("article").filter({ has: page.getByRole("heading", { name: product.name, exact: true }) }).getByRole("button", { name: /Добавить/ }).click();
        const name = `UI browser ${runId.slice(11, 19)}`;
        await page.locator('[name="customer_name"]').fill(name);
        await page.getByRole("button", { name: "Отправить на кухню", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('input[name="items"]')?.value === "[]", { timeout: 20000 });
        const [created] = await sql`select id,display_number,is_test,source from orders where customer_name=${name} order by created_at desc limit 1`;
        assert.ok(created && !created.is_test && created.source === "pos");
        report.browserOrder = created;
      });
      await action("kitchen station progression and unpaid handout guard", async () => {
        const order = report.fixtureOrders[2];
        await goto("/kitchen");
        let ticket = page.locator("article").filter({ hasText: order.display_number });
        assert.equal(await ticket.count(), 1);
        for (const station of ["snacks", "main"]) {
          for (const status of ["cooking", "ready"]) {
            ticket = page.locator("article").filter({ hasText: order.display_number });
            const form = ticket.locator("form").filter({ has: page.locator(`input[name="station"][value="${station}"]`) }).filter({ has: page.locator(`input[name="to_status"][value="${status}"]`) });
            await form.locator('button[type="submit"]').click();
            await page.waitForTimeout(800);
          }
        }
        const [ready] = await sql`select kitchen_status,payment_status from orders where id=${order.order_id}`;
        assert.equal(ready.kitchen_status, "ready");
        assert.notEqual(ready.payment_status, "paid");
        await page.screenshot({ path: join(output, "kitchen-mixed-stations-ready.png"), fullPage: false });
        const handout = ticket.getByRole("button", { name: "Выдан", exact: true });
        if (await handout.isVisible() && await handout.isEnabled()) {
          await handout.click();
          await page.waitForTimeout(800);
          const [guarded] = await sql`select kitchen_status from orders where id=${order.order_id}`;
          assert.equal(guarded.kitchen_status, "ready", "Unpaid handout must not be persisted");
          assert.match(await ticket.innerText(), /Оплата не подтверждена|оплатите|оплат/);
        }
      });
    }
    await context.close();
    context = null;
  }
  context = await browser.newContext({ storageState: authState });
  page = await context.newPage();
  await action("logout revokes protected access", async () => {
    await goto("/admin");
    await page.getByRole("button", { name: "Выйти", exact: true }).first().click();
    await page.waitForURL(/\/admin\/login/);
    await goto("/admin/notifications");
    assert.equal(new URL(page.url()).pathname, "/admin/login");
  });
} catch (error) {
  report.fatal = error.message;
  record("audit completed without fatal error", false, { error: error.message });
} finally {
  await stop();
  saveReport();
  console.log(JSON.stringify({ output, pages: report.pages.length, assertions: report.assertions.length, failures: report.assertions.filter(item => !item.passed).length, fatal: report.fatal, devStopped: true }));
}
if (report.assertions.some(item => !item.passed) || report.fatal) process.exitCode = 1;
