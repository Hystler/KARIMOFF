import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

function service(sql, enabled = true) {
  const code = ts.transpileModule(readFileSync('src/lib/integrations/evotor/pos-payments.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'process', code)(id => {
    if (id === 'server-only') return {};
    if (id === '@/lib/postgres/server') return { getPostgresSql: () => sql };
    if (id === './terminal-bridge') return { terminalBridgeReady: () => true };
    throw new Error(`Unexpected import ${id}`);
  }, exports, { env: { EVOTOR_POS_PAYMENTS_ENABLED: String(enabled), TEST_ORDER_MODE: 'false' } });
  return exports;
}

test('RC PG17 runtime: concurrent POS, unknown outcomes, restart and recovery are fail-safe', async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? '', /^postgres:\/\/karimoff_app@127\.0\.0\.1:55443\/karimoff_rc_fresh_\d+$/,
    'Run verify-release-database --local-only first and provide its runtimeDsn');
  const sql = postgres(dsn, { max: 8, onnotice() {} });
  try {
    const [identity] = await sql`select current_user as role, current_setting('server_version_num')::int as version`;
    assert.equal(identity.role, 'karimoff_app');
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    const api = service(sql);
    const [product] = await sql`insert into products(name,slug,category,price,is_active)
      values('Synthetic POS meal', ${`rc-${randomUUID()}`}, 'Бургеры', 100, true) returning id`;
    const [ingredient] = await sql`insert into ingredients(name,unit,cost_per_unit)
      values('Synthetic POS ingredient','g',1) returning id`;
    await sql`insert into inventory_items(ingredient_id,unit,current_quantity) values(${ingredient.id},'g',100)`;
    await sql`insert into product_ingredients(product_id,ingredient_id,quantity,unit)
      values(${product.id},${ingredient.id},10,'g')`;
    async function fixture() {
      const [location] = await sql`insert into order_locations(location_key,name)
        values(${`rc-${randomUUID()}`},'Synthetic RC point') returning id`;
      const [device] = await sql`insert into evotor_terminal_devices(location_id,device_key,token_hash,last_seen_at,paired_at)
        values(${location.id},${randomUUID()},${randomUUID().replaceAll('-','').repeat(2)},now(),now()) returning id`;
      const input = { locationId: location.id, customerId: null, customerName: 'Synthetic RC guest', comment: null,
        items: [{ product_id: product.id, quantity: 1, removed_ingredient_ids: [], extras: [], modifier_option_ids: [], note: '' }],
        idempotencyKey: randomUUID(), actorId: null, actorRole: 'owner' };
      return { input, deviceId: device.id };
    }
    async function state(job) {
      const [row] = await sql`select o.payment_status,o.fiscal_status,o.is_operational,
        (select count(*)::int from payments where order_id=o.id) as payments,
        (select count(*)::int from evotor_terminal_payment_intents where order_id=o.id) as intents,
        (select count(*)::int from order_outbox where aggregate_id=o.id and event_type='order.payment_succeeded') as kds,
        (select count(*)::int from canonical_analytics_sales where source_record_id=o.id) as sales,
        (select count(*)::int from order_inventory_deductions where order_id=o.id) as inventory
        from orders o where id=${job.orderId}`;
      assert.equal(row.payments, 1); assert.equal(row.intents, 1);
      return row;
    }
    const double = await fixture();
    const [a,b] = await Promise.all([api.createEvotorPosPayment(double.input), api.createEvotorPosPayment(double.input)]);
    assert.equal(a.intentId,b.intentId); assert.equal(a.orderId,b.orderId);
    assert.equal((await state(a)).kds,0);
    await assert.rejects(api.createEvotorPosPayment({ ...double.input,idempotencyKey:randomUUID() }), /незавершённой/);
    assert.equal((await api.nextEvotorTerminalPayment(double.deviceId)).id,a.intentId);
    assert.equal(await service(sql).nextEvotorTerminalPayment(double.deviceId),null, 'restart must not resend processing');
    await sql`update evotor_terminal_payment_intents set updated_at=now()-interval '6 minutes' where id=${a.intentId}`;
    assert.equal((await api.getEvotorPosPaymentStatus(a.intentId)).status,'unknown');
    await assert.rejects(api.createEvotorPosPayment({ ...double.input,idempotencyKey:randomUUID() }), /незавершённой/);
    const callback = { deviceId:double.deviceId,intentId:a.intentId,status:'paid',receiptReference:`synthetic-${randomUUID()}` };
    await Promise.all([service(sql).recordEvotorTerminalPaymentResult(callback),api.recordEvotorTerminalPaymentResult(callback)]);
    assert.deepEqual(await state(a), { payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:0 });
    await api.recordEvotorTerminalPaymentResult({ ...callback,status:'unknown',receiptReference:null });
    assert.equal((await state(a)).kds,1);
    for (const status of ['accepted','cooking','ready','ready']) {
      await sql`select set_order_kitchen_status_atomic(${a.orderId}::uuid,${status},null::uuid,'owner','rc')`;
    }
    const prepared = await state(a);
    assert.equal(prepared.inventory,1);
    assert.equal(prepared.sales,1);
    assert.equal(prepared.kds,1);
    const [stock] = await sql`select current_quantity::text as balance from inventory_items where ingredient_id=${ingredient.id}`;
    assert.equal(Number(stock.balance),90,'one recipe deduction even after repeated ready');

    const race = await fixture();
    const attempts = await Promise.allSettled([api.createEvotorPosPayment(race.input),
      api.createEvotorPosPayment({ ...race.input,idempotencyKey:randomUUID() })]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected').length,1);

    const queued = await fixture(); const q = await api.createEvotorPosPayment(queued.input);
    await sql`update evotor_terminal_payment_intents set updated_at=now()-interval '6 minutes' where id=${q.intentId}`;
    assert.equal((await api.getEvotorPosPaymentStatus(q.intentId)).status,'unknown');
    assert.equal(await api.nextEvotorTerminalPayment(queued.deviceId),null,'expired queued command must not be dispatched');
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:q.intentId,staffId:null,resolution:'paid' }),false);
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:q.intentId,staffId:null,resolution:'cancelled' }),true);
    assert.equal((await state(q)).kds,0);

    for (const status of ['failed','cancelled']) {
      const f = await fixture(); const job = await api.createEvotorPosPayment(f.input);
      await api.nextEvotorTerminalPayment(f.deviceId);
      await api.recordEvotorTerminalPaymentResult({ deviceId:f.deviceId,intentId:job.intentId,status,safeBeforePayment:true });
      assert.equal((await state(job)).is_operational,false);
      assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,status);
    }
    const fiscal = await fixture(); const job = await api.createEvotorPosPayment(fiscal.input);
    await api.nextEvotorTerminalPayment(fiscal.deviceId);
    await api.recordEvotorTerminalPaymentResult({ deviceId:fiscal.deviceId,intentId:job.intentId,status:'paid' });
    assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,'unknown');
    assert.equal((await state(job)).kds,0,'payment without fiscal proof remains blocked');
    await api.recordEvotorTerminalPaymentResult({ deviceId:fiscal.deviceId,intentId:job.intentId,status:'failed' });
    assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,'unknown');
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:job.intentId,staffId:null,resolution:'paid',receiptReference:'synthetic-recovered' }),true);
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:job.intentId,staffId:null,resolution:'paid',receiptReference:'synthetic-recovered' }),false);
    assert.equal((await state(job)).kds,1);
    const off = service(sql,false);
    await assert.rejects(off.createEvotorPosPayment((await fixture()).input),/отключена/);
    assert.equal(await off.nextEvotorTerminalPayment(race.deviceId),null);
    assert.equal((await off.recordEvotorTerminalPaymentResult(callback)).status,'paid','in-flight results remain accepted when disabled');
  } finally { await sql.end(); }
});
