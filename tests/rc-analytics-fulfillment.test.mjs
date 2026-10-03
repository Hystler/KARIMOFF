import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

function queryBuilder() {
  const exports = {};
  new Function('require','exports',ts.transpileModule(readFileSync('src/lib/analytics/query.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText)(id=> {
    if(id==='./categories') return {analyticsCategorySql:()=>"'unused'"};
    throw new Error(`Unexpected import ${id}`);
  },exports);
  return exports.buildSalesWhere;
}

test('RC PG17 runtime: legacy unknown fulfillment never becomes pickup; totals retain all three groups',async()=> {
  const dsn=process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn??'',/^postgres:\/\/karimoff_app@127\.0\.0\.1:55443\/karimoff_rc_fresh_\d+$/);
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('ROLLBACK_ANALYTICS_FIXTURE');
  try {
    await sql.begin(async tx=> {
      const ids=[];
      for(const type of ['pickup','delivery']) {
        const [order]=await tx`insert into orders(customer_name,customer_phone,delivery_type,total,is_test)
          values('Synthetic analytics guest','',${type},100,true) returning id`;
        ids.push(`web:${order.id}`);
      }
      ids.push(`evotor:${randomUUID()}`);
      const build=queryBuilder();
      const range={from:new Date('2026-10-03T00:00:00Z'),to:new Date('2026-10-04T00:00:00Z')};
      const filters={channel:'all',weekdays:[],categories:[],hourFrom:null,hourTo:null};
      const amounts={};
      for(const fulfillment of ['all','pickup','delivery']) {
        const where=build({...filters,fulfillment},range,{locationIds:null});
        const result=await tx.unsafe(`with s(sale_id,analytics_at,net_revenue) as (
          select sale_id,'2026-10-03T12:00:00Z'::timestamptz,100::numeric
          from unnest($3::text[]) sale_id
        ) select count(*)::int as n,sum(net_revenue)::text as revenue from s where ${where.text}`,
          [...where.values,ids]);
        amounts[fulfillment]=result[0];
      }
      assert.deepEqual(amounts.pickup,{n:1,revenue:'100'});
      assert.deepEqual(amounts.delivery,{n:1,revenue:'100'});
      assert.deepEqual(amounts.all,{n:3,revenue:'300'});
      assert.equal(Number(amounts.all.revenue)-Number(amounts.pickup.revenue)-Number(amounts.delivery.revenue),100);
      throw rollback;
    });
  } catch(error) {if(error!==rollback) throw error;}
  finally {await sql.end();}
});
