import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function compile(source, env = {}, imports = {}, extras = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, process: { env }, URL, Headers, Request, Response,
    require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency: ${name}`); }, ...extras });
  return loadedModule.exports;
}
function policy(env = {}) { return compile(readFileSync('src/lib/product-edition.ts', 'utf8'), env); }
function files(dir) { return readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }

test('cabinet is the default; preserved full edition remains explicit; typo fails closed', () => {
  assert.equal(policy().getProductEdition(), 'analytics');
  assert.equal(policy({KARIMOFF_EDITION:'full'}).getProductEdition(), 'full');
  assert.equal(policy().isEditionPathAllowed('/kitchen', 'full'), true);
  assert.throws(() => policy({KARIMOFF_EDITION:'analtyics'}).getProductEdition(), /Invalid/);
});

test('analytics routes are explicitly enumerated, including APIs and catalog support', () => {
  const p = policy({KARIMOFF_EDITION:'analytics'});
  for (const route of ['/admin','/admin/products','/admin/products/new','/admin/ingredients/extras','/admin/production','/admin/integrations/evotor','/api/integrations/evotor/token','/api/internal/evotor/sync','/api/terminal/health','/api/terminal/orders/next','/admin/inventory','/admin/inventory/movements','/admin/ingredients','/admin/economics','/admin/analytics','/admin/analytics/audience','/admin/analytics/sales','/admin/analytics/planning','/api/admin/analytics/sales/export']) assert.equal(p.isEditionPathAllowed(route, 'analytics'),true,route);
  for (const route of ['/franchise','/kitchen','/display','/pos','/admin/orders','/admin/staff','/admin/settings','/admin/integrations/evotor/pos-payments','/admin/integrations/evotor/reconciliation','/api/terminal/payments/next','/api/webhooks/yookassa','/api/auth/avatar','/admin/analytics/new-module']) assert.equal(p.isEditionPathAllowed(route,'analytics'),false,route);
});

test('HTTP boundary blocks page, RSC and forged action requests before handler execution', () => {
  const env={KARIMOFF_EDITION:'analytics'};
  const p=policy(env);
  const proxy=compile(readFileSync('src/proxy.ts','utf8'),env,{
    'next/server':require('next/server'), '@/lib/product-edition':p,
    '@/lib/maintenance':compile(readFileSync('src/lib/maintenance.ts','utf8'),env),
    '@/lib/security/opaque-staff-login-origin':{getOpaqueStaffLoginOriginHeaders:()=>null}
  }).proxy;
  const {NextRequest}=require('next/server');
  for (const route of ['/franchise','/kitchen','/api/terminal/payments/next','/admin/orders','/robots.txt','/sitemap.xml','/api/auth/avatar']) for (const method of ['GET','POST','HEAD']) {
    const response=proxy(new NextRequest(`http://localhost${route}`,{method,headers:{'next-action':'old-action-id',rsc:'1','x-karimoff-path':'/admin/analytics'}}));
    assert.equal(response.status,404,`${method} ${route}`);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  }
  assert.equal(proxy(new NextRequest('http://localhost/')).headers.get('Location'),'http://localhost/admin');
  assert.equal(proxy(new NextRequest('http://localhost/admin/login')).status,200);
  assert.equal(proxy(new NextRequest('http://localhost/api/admin/analytics/sales/export')).status,200);
});

test('every excluded server action rejects even when replayed on an allowed URL', async () => {
  const p=policy({KARIMOFF_EDITION:'analytics'});
  const allowedFiles=new Set(['/admin/login','/admin/inventory','/admin/ingredients','/admin/economics','/admin/analytics','/admin/products','/admin/ingredients/extras','/admin/production']);
  let guarded=0;
  for (const file of files('src/app')) {
    if (!/\.tsx?$/.test(file)) continue;
    const source=readFileSync(file,'utf8');
    if (!/^['"]use server['"];/.test(source)) continue;
    let capability='/'+file.slice('src/app/'.length,file.lastIndexOf('/'));
    if(capability==='/actions')capability='/';
    if(allowedFiles.has(capability))continue;
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    for(const n of ast.statements){
      if(!ts.isFunctionDeclaration(n)||!n.body||!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
      if (capability === '/admin/integrations/evotor' && n.name.text !== 'queueTerminalTestPreviewAction') continue;
      // Execute the real function body with no DB/auth/network mocks. It must reject
      // before referencing any dependency, regardless of the request's URL or role.
      assert.match(n.body.statements[0].getText(ast),/^assertEditionActionAllowed\(/,`${file}:${n.name.text}`);
      const action=compile(n.getText(ast),{}, {}, {assertEditionActionAllowed:p.assertEditionActionAllowed})[n.name.text];
      await assert.rejects(()=>action(new FormData()),/unavailable in this product edition/,`${file}:${n.name.text}`);
      guarded++;
    }
  }
  assert.equal(guarded,45);
});

test('restricted edition starts only the configured Evotor import scheduler', async () => {
  let starts=0;
  const loader=()=>{starts++;};
  const env={NEXT_RUNTIME:'nodejs',KARIMOFF_EDITION:'analytics'};
  const result=compile(readFileSync('src/instrumentation.ts','utf8'),env,{
    '@/lib/product-edition':policy(env),
    '@/lib/integrations/evotor/scheduler':{startEvotorBackgroundScheduler:loader},
    '@/lib/payments/yookassa/scheduler':{startYooKassaBackgroundScheduler:loader},
    '@/lib/notifications/order-status/scheduler':{startOrderNotificationScheduler:loader}
  });
  await result.register(); assert.equal(starts,1);
});


test('cabinet admits one selected owner identity and preserves full-edition staff behavior', () => {
 const legacy={id:null,role:'admin',legacy:true}, owner={id:'11111111-1111-4111-8111-111111111111',role:'owner',legacy:false};
 assert.equal(policy().isEditionOwnerAllowed(legacy),true);
 assert.equal(policy().isEditionOwnerAllowed(owner),false);
 const named=policy({KARIMOFF_OWNER_STAFF_ID:owner.id});
 assert.equal(named.isEditionOwnerAllowed(owner),true);
 assert.equal(named.isEditionOwnerAllowed(legacy),false);
 assert.equal(named.isEditionOwnerAllowed({...owner,role:'cook'}),false);
 assert.equal(named.isEditionOwnerAllowed({...owner,id:'22222222-2222-4222-8222-222222222222'}),false);
 assert.equal(policy({KARIMOFF_OWNER_STAFF_ID:'invalid'}).isEditionOwnerAllowed(owner),false);
 assert.equal(policy({KARIMOFF_EDITION:'full'}).isEditionOwnerAllowed({...owner,role:'cook'}),true);
});

test('terminal polling retains authentication and heartbeat but never consumes a queued job', async () => {
 let authenticated=0,jobs=0;
 const route=compile(readFileSync('src/app/api/terminal/orders/next/route.ts','utf8'),{}, {
  'next/server':require('next/server'), '@/lib/product-edition':policy(),
  '@/lib/integrations/evotor/terminal-bridge':{authenticateTerminal:async()=>{authenticated++;return {id:'demo-terminal'};},nextTerminalPreview:async()=>{jobs++;throw Error('must not dequeue');}}
 });
 assert.deepEqual(await (await route.GET(new Request('http://localhost/api/terminal/orders/next'))).json(),{ok:true,job:null});
 assert.equal(authenticated,1);assert.equal(jobs,0);
});


test('session verification denies existing non-owner staff sessions in the cabinet', async () => {
 const id='11111111-1111-4111-8111-111111111111';
 for(const [selected,role,expected] of [[undefined,'owner',false],[id,'owner',true],[id,'cashier',false]]) {
  const env={SESSION_SECRET:'synthetic-session-secret',KARIMOFF_OWNER_STAFF_ID:selected};
  let query=0;
  const db={from(){const builder={select(){return this;},eq(){return this;},in(){return this;},is(){return this;},gt(){return this;},async maybeSingle(){return {data:query++===0?{subject_type:'staff',subject_id:id}:{id,role,name:'Synthetic',phone:'+70000000000',is_active:true}};}};return builder;}};
  const auth=compile(readFileSync('src/lib/admin-auth.ts','utf8'),env,{
   'server-only':{}, 'node:crypto':require('node:crypto'), '@/lib/product-edition':policy(env),
   'next/headers':{cookies:async()=>({get:()=>({value:'synthetic-token'})})},
   '@/lib/phone':{normalizeRussianPhone:v=>v}, '@/lib/database/server':{createDatabaseServerClient:()=>db},
   '@/lib/password-auth':{}, '@/lib/totp':{}
  },{Buffer});
  assert.equal(Boolean(await auth.getCurrentStaff()),expected);
 }
});

test('cabinet overview renders the retained modules without operational queues or customer links', async () => {
 const React=require('react'), {renderToStaticMarkup}=require('react-dom/server');
 const component=compile(readFileSync('src/components/admin/RustamOverview.tsx','utf8'),{}, {
  'react/jsx-runtime':require('react/jsx-runtime'), 'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
  '@/lib/analytics/permissions':{getAnalyticsScope:async()=>({})},
  '@/lib/admin-overview':{getAdminDailySales:async()=>({revenue:100,sales:2,error:false}),getAdminOverviewSnapshot:async()=>({error:null,snapshot:{activeProducts:3,productsWithoutFoodCost:1,inventoryCards:5,lowStockItems:2,productionRuns30d:4}})}
 }).RustamOverview;
 const html=renderToStaticMarkup(await component());
 for(const path of ['/admin/products','/admin/ingredients/extras','/admin/inventory','/admin/analytics/planning','/admin/production','/admin/economics','/admin/analytics','/admin/integrations/evotor'])assert.ok(html.includes('href="'+path+'"'),path);
 for(const path of ['/admin/orders','/kitchen','/pos','/admin/customers','/admin/staff','/admin/settings'])assert.ok(!html.includes('href="'+path+'"'),path);
 assert.ok(html.includes('100 ₽'));
});
