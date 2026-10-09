import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

function loadWithEnvironment(file, imports, environment) {
  const code=ts.transpileModule(readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  const exports={};
  new Function('require','exports','process',code)(id=>{
    assert.ok(id in imports,`Unexpected test import ${id}`);
    return imports[id];
  },exports,{env:environment});
  return exports;
}

test('combined order service uses the real named PostgreSQL adapter for pickup and whitelist delivery', {
  skip: !process.env.KARIMOFF_RC_LOCAL_DSN && 'Requires a disposable local PostgreSQL database'
}, async()=>{
  const dsn=process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn??'',/^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/);
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('ROLLBACK_NAMED_RPC_FIXTURE');
  try {
    await sql.begin(async tx=>{
      const adapter=loadWithEnvironment('src/lib/postgres/server.ts',{
        'server-only':{},postgres:url=>{assert.equal(url,dsn);return tx;}
      },{DATABASE_URL:dsn});
      const database=loadWithEnvironment('src/lib/database/server.ts',{
        'server-only':{},'@/lib/postgres/server':adapter
      },{DATABASE_URL:dsn});
      const service=loadWithEnvironment('src/lib/order-flow/service.ts',{
        'server-only':{},'@/lib/database/server':database,'@/lib/postgres/server':adapter,
        '@/lib/observability':{logOperationalEvent(){}}
      },{TEST_ORDER_MODE:'false'});
      await tx`update site_settings set delivery_enabled=true,delivery_coverage_enabled=true where id='main'`;
      await tx`update delivery_location_settings set enabled=true,acceptance_start='00:00',acceptance_end='23:59'`;
      const [customer]=await tx`insert into customers(name,phone) values('Synthetic adapter guest',${`+7${String(Date.now()).slice(-10)}`}) returning id`;
      const [product]=await tx`insert into products(name,slug,category,price,is_active)
        values('Synthetic adapter meal',${randomUUID()},'Бургеры',2499,true) returning id`;
      const [location]=await tx`select id from order_locations where is_default and is_active`;
      const [address]=await tx`insert into delivery_addresses(location_id,street,street_normalized,house,house_normalized,
        latitude,longitude,distance_meters,is_available,source)
        values(${location.id},'Adapter street','adapterstreet','1','1',55.909221,38.055708,0,true,'synthetic') returning id`;
      for(const deliveryType of ['pickup','delivery']) {
        const input={source:'web',customerId:customer.id,deliveryType,
          deliveryAddressId:deliveryType==='delivery'?address.id:null,
          deliveryDetails:deliveryType==='delivery'?{apartment:'',entrance:'',floor:'',intercom:'',courierComment:''}:null,
          comment:null,items:[{product_id:product.id,quantity:1}],idempotencyKey:randomUUID(),
          personalDataGranted:true,offerAccepted:true,marketingGranted:false,documentVersion:'rc',
          sourcePath:'/rc',userAgentShort:'rc',fulfillmentMode:'asap',requestedAt:null,
          receiptEmail:'mock@example.test',requiresPayment:true};
        const first=await service.createOrder(input);
        const retry=await service.createOrder(input);
        assert.equal(first.orderId,retry.orderId);assert.equal(first.paymentId,retry.paymentId);
        assert.equal(first.total,deliveryType==='delivery'?2699:2499);
      }
      throw rollback;
    });
  } catch(error) {if(error!==rollback)throw error;}
  finally {await sql.end();}
});

test('RC PG17 runtime: delivery pricing, payment gating, immutable address and two receipts', {
  skip: !process.env.KARIMOFF_RC_LOCAL_DSN && 'Requires a disposable local PostgreSQL database'
}, async () => {
  const dsn=process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn??'',/^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/);
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('ROLLBACK_DELIVERY_FIXTURE');
  try {
    await sql.begin(async tx=> {
      await tx`update site_settings set delivery_enabled=true,delivery_coverage_enabled=true where id='main'`;
      await tx`update delivery_location_settings set enabled=true,acceptance_start='00:00',acceptance_end='23:59'`;
      const [location]=await tx`select id from order_locations where is_default and is_active`;
      const [address]=await tx`insert into delivery_addresses(location_id,street,street_normalized,house,house_normalized,
        latitude,longitude,distance_meters,is_available,source)
        values(${location.id},'Synthetic street','syntheticstreet','1','1',55.909221,38.055708,0,true,'synthetic') returning id`;
      const [customer]=await tx`insert into customers(name,phone) values('Synthetic delivery guest',${`+7${String(Date.now()).slice(-10)}`}) returning id`;
      for (const subtotal of [1,200,2499,2500,2501]) {
        const fee=subtotal<2500?200:0;
        const [product]=await tx`insert into products(name,slug,category,price,is_active)
          values('Synthetic delivery item',${randomUUID()},'Бургеры',${subtotal},true) returning id`;
        const key=randomUUID();
        const create=()=>tx`select * from create_site_order_with_payment_from_whitelist(
          ${customer.id}::uuid,'delivery',${address.id}::uuid,${tx.json({courierComment:'Synthetic comment'})}::jsonb,null,
          ${tx.json([{product_id:product.id,quantity:1}])}::jsonb,${key}::uuid,
          true,true,false,'rc','/rc','rc','asap',null::timestamptz,'mock@example.test',${key})`;
        const [order]=await create();
        const [retry]=await create();
        assert.equal(retry.order_id,order.order_id);
        assert.equal(retry.payment_id,order.payment_id);
        await assert.rejects(tx.savepoint(inner=>inner`select * from create_site_order_with_payment_from_whitelist(
          ${customer.id}::uuid,'delivery',${address.id}::uuid,${inner.json({courierComment:'Changed'})}::jsonb,null,
          ${inner.json([{product_id:product.id,quantity:2}])}::jsonb,${key}::uuid,
          true,true,false,'rc','/rc','rc','asap',null::timestamptz,'mock@example.test',${key})`),/другим заказом или адресом/);
        assert.equal(Number(order.total),subtotal+fee,'server computes delivery fee from canonical merchandise');
        const rows=await tx`select * from order_items where order_id=${order.order_id} and item_type='delivery_fee'`;
        assert.equal(rows.length,fee?1:0); if(fee) assert.equal(Number(rows[0].line_total),200);
        const [before]=await tx`select payment_status,is_operational,delivery_apartment from orders where id=${order.order_id}`;
        assert.equal(before.payment_status,'pending'); assert.equal(before.is_operational,false); assert.equal(before.delivery_apartment,null);
        await assert.rejects(tx.savepoint(inner=>inner`update orders set delivery_house='2' where id=${order.order_id}`),/не может быть изменён/);
        await assert.rejects(tx.savepoint(inner=>inner`update orders set delivery_address_id=null where id=${order.order_id}`),/Адрес доставки уже закреплён/);
        const [snapshot]=await tx`select delivery_address_snapshot from orders where id=${order.order_id}`;
        assert.equal(Number(snapshot.delivery_address_snapshot.delivery_fee),fee);
        const providerId=`synthetic-${randomUUID()}`;
        // A late succeeded event has no acceptance-hours gate. The order already exists.
        const latePaidAt=new Date('2026-10-03T17:31:00Z');
        for(let repeat=0;repeat<2;repeat++) await tx`select apply_yookassa_payment_state(
          ${order.payment_id}::uuid,${providerId},'succeeded',true,${subtotal+fee},'RUB','succeeded','bank_card',
          ${subtotal+fee},${latePaidAt},${latePaidAt})`;
        const [paid]=await tx`select payment_status,is_operational,delivery_status from orders where id=${order.order_id}`;
        assert.equal(paid.payment_status,'paid'); assert.equal(paid.is_operational,true); assert.equal(paid.delivery_status,'paid');
        const [events]=await tx`select count(*)::int as n from order_outbox where aggregate_id=${order.order_id} and event_type='order.payment_succeeded'`;
        assert.equal(events.n,1);
        await tx`select set_order_kitchen_status_atomic(${order.order_id}::uuid,'accepted',null::uuid,'owner','rc')`;
        await tx`select set_order_kitchen_status_atomic(${order.order_id}::uuid,'cooking',null::uuid,'owner','rc')`;
        await tx`select set_order_kitchen_status_atomic(${order.order_id}::uuid,'ready',null::uuid,'owner','rc')`;
        const [inventoryBefore]=await tx`select count(*)::int as n from order_inventory_deductions where order_id=${order.order_id}`;
        await tx`select set_order_delivery_status_atomic(${order.order_id}::uuid,'handed_to_courier',null::uuid,'owner','rc')`;
        const [courier]=await tx`select delivery_status from orders where id=${order.order_id}`;
        assert.equal(courier.delivery_status,'courier_in_transit');
        const closing=async()=>tx`select * from fiscal_receipts where order_id=${order.order_id} and receipt_phase='prepayment_settlement'`;
        assert.equal((await closing()).length,0);
        await tx`select set_order_delivery_status_atomic(${order.order_id}::uuid,'handed_out',null::uuid,'owner','rc')`;
        assert.equal((await closing()).length,1);
        await tx`update orders set kitchen_status='handed_out' where id=${order.order_id}`;
        assert.equal((await closing()).length,1);
        const [sale]=await tx`select count(*)::int as n,sum(net_revenue)::text as revenue from canonical_analytics_sales where source_record_id=${order.order_id}`;
        assert.equal(sale.n,1); assert.equal(Number(sale.revenue),subtotal+fee);
        const [inventory]=await tx`select count(*)::int as n from order_inventory_deductions where order_id=${order.order_id}`;
        assert.equal(inventory.n,inventoryBefore.n,'fiscal and courier transitions never deduct inventory again');
      }
      throw rollback;
    });
  } catch(error) { if(error!==rollback) throw error; }
  finally { await sql.end(); }
});

test('delivery cutoff is checked before creation, never re-applied by payment confirmation',()=> {
  const actions=readFileSync('src/app/actions/orders.ts','utf8');
  assert.match(actions,/isDeliveryAcceptingAt\(new Date\(\), config\)/);
  assert.match(actions,/findDeliveryAddressById\(parsed\.data\.delivery_address_id/);
  assert.doesNotMatch(actions,/formData\.get\("(?:latitude|longitude)"\)/);
  const payments=readFileSync('src/lib/payments/yookassa/service.ts','utf8');
  assert.doesNotMatch(payments,/isDeliveryAcceptingAt|acceptanceEnd/);
});
