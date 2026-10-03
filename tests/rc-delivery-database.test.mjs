import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';

test('RC PG17 runtime: delivery pricing, payment gating, immutable address and two receipts', async () => {
  const dsn=process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn??'',/^postgres:\/\/karimoff_app@127\.0\.0\.1:55443\/karimoff_rc_fresh_\d+$/);
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('ROLLBACK_DELIVERY_FIXTURE');
  try {
    await sql.begin(async tx=> {
      await tx`update site_settings set delivery_enabled=true,delivery_coverage_enabled=true where id='main'`;
      await tx`update delivery_location_settings set enabled=true`;
      const [customer]=await tx`insert into customers(name,phone) values('Synthetic delivery guest',${`+7${String(Date.now()).slice(-10)}`}) returning id`;
      for (const subtotal of [1,200,2499,2500,2501]) {
        const fee=subtotal<2500?200:0;
        const [product]=await tx`insert into products(name,slug,category,price,is_active)
          values('Synthetic delivery item',${randomUUID()},'Бургеры',${subtotal},true) returning id`;
        const snapshot={ address_text:'Synthetic house',street:'Synthetic street',house:'1',apartment:'',entrance:'',floor:'',
          intercom:'',courier_comment:'Synthetic comment',latitude:55.909221,longitude:38.055708,distance_meters:0,
          delivery_fee:999,eta_minutes:60,zone_validation:'available',validated_at:new Date().toISOString() };
        const [order]=await tx`select * from create_site_order_with_payment(
          ${customer.id}::uuid,'delivery','Synthetic house',null,
          ${tx.json([{product_id:product.id,quantity:1}])}::jsonb,${randomUUID()}::uuid,
          true,true,false,'rc','/rc','rc','asap',null::timestamptz,'mock@example.test',${randomUUID()},${tx.json(snapshot)}::jsonb)`;
        assert.equal(Number(order.total),subtotal+fee,'server must ignore forged delivery fee');
        const rows=await tx`select * from order_items where order_id=${order.order_id} and item_type='delivery_fee'`;
        assert.equal(rows.length,fee?1:0); if(fee) assert.equal(Number(rows[0].line_total),200);
        const [before]=await tx`select payment_status,is_operational,delivery_apartment from orders where id=${order.order_id}`;
        assert.equal(before.payment_status,'pending'); assert.equal(before.is_operational,false); assert.equal(before.delivery_apartment,null);
        await assert.rejects(tx.savepoint(inner=>inner`update orders set delivery_house='2' where id=${order.order_id}`),/не может быть изменён/);
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
  assert.match(actions,/isDeliveryAcceptingAt\(new Date\(\), resolved\.config\)/);
  assert.match(actions,/resolveDeliveryAddress\(parsed\.data\.delivery_street/);
  assert.doesNotMatch(actions,/formData\.get\("(?:latitude|longitude)"\)/);
  const payments=readFileSync('src/lib/payments/yookassa/service.ts','utf8');
  assert.doesNotMatch(payments,/isDeliveryAcceptingAt|acceptanceEnd/);
});
