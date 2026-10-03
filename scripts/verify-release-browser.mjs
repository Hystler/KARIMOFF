import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

assert.deepEqual(process.argv.slice(2),['--local-only']);
const evidence=JSON.parse(readFileSync('outputs/release-20261003/database/ready.json','utf8'));
assert.equal(evidence.port,55443); assert.match(evidence.databases.restore,/^karimoff_rc_restore_\d+$/);
const sql=postgres(`postgres://karimoff_app@127.0.0.1:55443/${evidence.databases.restore}`,{max:1,onnotice(){}});
const origin='http://127.0.0.1:3110'; const container=`karimoff-final-rc-browser-20261003-${Date.now()}`;
const output=resolve('outputs/release-20261003/browser'); mkdirSync(output,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href);
const secret=randomBytes(32).toString('hex'); let browser; let started=false;
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const results=[];
try {
  assert.ok(!docker(['ps','-a','--format','{{.Names}}']).split('\n').includes(container),'Refusing to replace another container');
  const [customer]=await sql`select id from customers order by created_at limit 1`;
  const [staff]=await sql`insert into staff_users(name,phone,password_hash,role,is_active)
    values('Synthetic RC owner',${`+7${String(Date.now()).slice(-10)}`},'mock-only','owner',true) returning id`;
  const [product]=await sql`insert into products(name,slug,category,price,image_url,description,is_active)
    select name,${`rc-browser-${randomUUID()}`},category,price,image_url,description,true
    from products where is_active and image_url is not null and slug not like 'rc-browser-%' order by id limit 1
    returning id,name,slug,price,image_url`;
  const [ingredient]=await sql`insert into ingredients(name,unit,cost_per_unit)
    values('Synthetic browser ingredient','g',1) returning id`;
  const [group]=await sql`insert into product_modifier_groups(product_id,name,selection_type,min_selections,max_selections)
    values(${product.id},'RC required modifier','single',1,1) returning id`;
  const [option]=await sql`insert into product_modifier_options(group_id,label,modifier_type,ingredient_id,quantity_delta,price_delta)
    values(${group.id},'RC modifier choice','add',${ingredient.id},10,30) returning id`;
  const tokens={};
  for(const [subject,id] of [['customer',customer.id],['staff',staff.id]]) {
    tokens[subject]=randomBytes(32).toString('base64url');
    await sql`insert into app_sessions(subject_type,subject_id,token_hash,expires_at)
      values(${subject},${id},${createHmac('sha256',secret).update(tokens[subject]).digest('hex')},now()+interval '2 hours')`;
  }
  await sql`update site_settings set delivery_enabled=true,delivery_coverage_enabled=true,pickup_enabled=true where id='main'`;
  await sql`update delivery_location_settings set enabled=true`;
  const databaseIp=docker(['inspect',evidence.container,'--format','{{.NetworkSettings.Networks.bridge.IPAddress}}']);
  assert.match(databaseIp,/^172\.\d+\.\d+\.\d+$/);
  const environment={ DATABASE_URL:`postgres://karimoff_app@${databaseIp}:5432/${evidence.databases.restore}`,
    RUNTIME_MIGRATIONS_READ_ONLY:'true',SESSION_SECRET:secret,APP_ORIGIN:'https://127.0.0.1:3110',
    EVOTOR_ENABLED:'false',EVOTOR_BACKGROUND_SYNC:'false',EVOTOR_TERMINAL_BRIDGE_ENABLED:'false',EVOTOR_POS_PAYMENTS_ENABLED:'false',
    APPLE_WALLET_ENABLED:'false',ORDER_STATUS_NOTIFICATIONS_ENABLED:'false',TEST_ORDER_MODE:'false',PAYMENTS_ENABLED:'true',
    YOOKASSA_SHOP_ID:'synthetic-only',YOOKASSA_SECRET_KEY:'synthetic-only',
    YOOKASSA_RETURN_URL:'https://127.0.0.1:3110/checkout/payment/return',YOOKASSA_WEBHOOK_URL:'https://127.0.0.1:3110/api/webhooks/yookassa',
    DELIVERY_ENABLED:'true',YANDEX_GEOCODER_API_KEY:'synthetic-only',YANDEX_SUGGEST_API_KEY:'synthetic-only',
    NODE_OPTIONS:'--import /app/rc-mock-network.mjs' };
  const args=['run','-d','--name',container,'--label','karimoff.rc-browser=20261003','-p','127.0.0.1:3110:3000',
    '-v',`${resolve('scripts/rc-mock-network.mjs')}:/app/rc-mock-network.mjs:ro`];
  for(const [key,value] of Object.entries(environment)) args.push('-e',`${key}=${value}`);
  args.push('karimoff-rc:20261003'); docker(args); started=true;
  for(let i=0;i<80;i++) {
    if(await fetch(`${origin}/api/health`).then(r=>r.ok).catch(()=>false)) break;
    assert.ok(i<79,'Docker app did not become healthy'); await new Promise(r=>setTimeout(r,500));
  }
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const viewports=[{width:390,height:844},{width:430,height:932},{width:768,height:1024},
    {width:1024,height:768},{width:1440,height:900},{width:1920,height:1080}];
  for(const viewport of viewports) {
    const context=await browser.newContext({viewport,locale:'ru-RU'});
    await context.route('**/*',route=> {
      const url=new URL(route.request().url());
      return url.origin===origin?route.continue():route.abort();
    });
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const check=async(path,label=path)=> {
      const response=await page.goto(`${origin}${path}`,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(400);
      const status=response.status();
      assert.equal(status,path==='/rc-nonexistent'?404:200,label);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      const text=await page.locator('body').innerText();
      assert.doesNotMatch(text,/Application error|Internal Server Error|Табло временно недоступно|POS временно недоступен/);
      results.push({viewport,path:label,status,overflow,url:new URL(page.url()).pathname,errors:[...errors]});
      const filename=label.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'home';
      await page.screenshot({path:`${output}/${viewport.width}-${filename}.png`,fullPage:false});
      return text;
    };
    for(const path of ['/','/menu',`/menu/${product.slug}`,'/login?redirectTo=%2Fcheckout','/register',
      '/checkout/payment/return','/rc-nonexistent','/display']) await check(path);
    await page.goto(`${origin}/admin`);
    assert.equal(new URL(page.url()).pathname,'/admin/login','Anonymous staff access is denied');
    await page.goto(`${origin}/menu/${product.slug}`);
    await page.waitForTimeout(350);
    const cookieButton=page.getByRole('button',{name:'Только необходимые',exact:true});
    if(await cookieButton.count()) await cookieButton.click();
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(()=>document.activeElement?.tagName),'BODY');
    const addButton=page.getByRole('button',{name:/Добавить в корзину/}).first();
    assert.ok(await addButton.isDisabled(),'Required modifier blocks adding until selected');
    await page.getByRole('button',{name:/RC modifier choice/}).click();
    assert.ok(await addButton.isEnabled());
    await page.getByRole('button',{name:/Добавить в корзину/}).first().click();
    assert.ok(await page.evaluate(id=>JSON.parse(localStorage.getItem('karimoff_cart')??'[]')
      .some(line=>line.customization.modifierOptionIds.includes(id)),option.id),'Chosen modifier survives into cart');
    if(viewport.width<1280) {
      await page.evaluate(()=>scrollTo(0,0));
      await page.locator('.product-sticky-purchase').waitFor({state:'visible'});
      await page.screenshot({path:`${output}/${viewport.width}-product-sticky.png`});
      await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
      await page.locator('.product-sticky-purchase').waitFor({state:'hidden'});
      assert.ok(await page.locator('footer').evaluate(el=>el.getBoundingClientRect().top<innerHeight),
        'Footer is reachable without sticky purchase overlay');
      await page.screenshot({path:`${output}/${viewport.width}-product-footer.png`});
      await page.evaluate(()=>scrollTo(0,0));
      await page.locator('.product-sticky-purchase').waitFor({state:'visible'});
      results.push({viewport,path:'product-sticky-and-footer',status:200,overflow:false,
        stickyVisibleAbove:true,stickyHiddenAtFooter:true,stickyRestoredAfterFooter:true});
    }
    await context.addCookies([{name:'karimoff_customer_session',value:tokens.customer,url:origin}]);
    for(const path of ['/profile','/profile/orders','/profile/loyalty']) await check(path);
    await page.evaluate(product=>localStorage.setItem('karimoff_cart',JSON.stringify([
      {lineId:product.id,product,quantity:1,customization:{removed:[],extras:[],modifierOptionIds:[],note:''}}
    ])),product);
    await check('/checkout','checkout-pickup');
    await page.waitForTimeout(500);
    assert.ok(await page.locator('input[name="receipt_email"]').count(),'Authenticated checkout must load');
    await page.locator('input[name="delivery_type"][value="delivery"]').check();
    await page.locator('input[name="delivery_street"]').fill('Бахчиванджи');
    await page.locator('input[name="delivery_house"]').fill('5Б');
    await page.locator('input[name="delivery_house"]').blur();
    await page.getByRole('button',{name:'Проверить адрес',exact:true}).click();
    await page.waitForTimeout(1200);
    await page.locator('input[name="receipt_email"]').fill('mock@example.test');
    const dialog=page.locator('[role="dialog"]');
    const dialogOverflow=await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1);
    results.push({viewport,path:'checkout-delivery',status:200,overflow:dialogOverflow,
      mockGeocoder:true,addressMessage:(await dialog.innerText()).includes('Доставим по этому адресу')});
    await page.screenshot({path:`${output}/${viewport.width}-checkout-delivery.png`});
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'Cart traps keyboard focus');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[role="dialog"]').count(),0,'Escape closes cart');
    await page.evaluate(product=>localStorage.setItem('karimoff_cart',JSON.stringify([
      {lineId:product.id,product,quantity:Math.ceil(2500/Number(product.price)),customization:{removed:[],extras:[],modifierOptionIds:[],note:''}}
    ])),product);
    await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(800);
    await page.locator('input[name="delivery_type"][value="delivery"]').check();
    await page.locator('input[name="delivery_street"]').fill('Бахчиванджи');
    await page.locator('input[name="delivery_house"]').fill('5Б');
    await page.getByRole('button',{name:'Проверить адрес',exact:true}).click(); await page.waitForTimeout(700);
    assert.match(await page.locator('[role="dialog"]').innerText(),/бесплатно/);
    results.push({viewport,path:'checkout-free-delivery',status:200,overflow:false,mockGeocoder:true});
    await page.screenshot({path:`${output}/${viewport.width}-checkout-free-delivery.png`});
    await context.addCookies([{name:'karimoff_admin_session',value:tokens.staff,url:origin}]);
    for(const path of ['/admin','/admin/orders','/admin/analytics','/admin/analytics/sales','/admin/economics','/pos','/kitchen']) {
      await check(path); assert.equal(new URL(page.url()).pathname,path,'Staff session must not redirect to login');
    }
    await context.close();
  }
  writeFileSync(`${output}/results.json`,JSON.stringify({checkedAt:new Date().toISOString(),
    image:docker(['image','inspect','karimoff-rc:20261003','--format','{{.Id}}']),
    isolation:'restored synthetic PG17; runtime role; no real secrets; external fetch blocked; no order/payment submission',results},null,2)+'\n');
  const failures=results.filter(r=>r.overflow||r.errors?.length||r.path==='checkout-delivery'&&!r.addressMessage);
  console.log(JSON.stringify({screens:results.length,failures},null,2));
  assert.equal(failures.length,0,'See isolated browser evidence');
} finally {
  await browser?.close(); await sql.end();
  if(started) { writeFileSync(`${output}/runtime.log`,docker(['logs',container])); docker(['stop',container]); }
}
