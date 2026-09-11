import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import postgres from 'postgres';

function compile(path, imports) {
  const code = ts.transpileModule(readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const result={};
  new Function('require','exports',code)((id)=>{if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id];},result);
  return result;
}
const catalog=compile('src/lib/extras-catalog.ts',{});
test('extras cover all requested portions and product-specific proteins',()=>{
  assert.equal(catalog.extrasCatalog.length,22);
  assert.equal(new Set(catalog.extrasCatalog.map(e=>e.key)).size,22);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='fries').quantity,50);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='patty').quantity,110);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='chicken-patty').price,150);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='shrimp').price,50);
  assert.equal(catalog.extrasCatalog.filter(e=>e.key.startsWith('sausage-')).length,3);
  assert.ok(catalog.extrasCatalog.every(e=>e.price>0 && e.quantity>0));
});
test('every food type exposes three logical extras and shrimp never receives jalapeno',()=>{
  assert.deepEqual(catalog.extraKeysForProduct('Татарин','Бургеры'),['patty','cheese-stick','jalapeno']);
  assert.deepEqual(catalog.extraKeysForProduct('Чикенбургер','Бургеры'),['chicken-patty','cheese-stick','jalapeno']);
  assert.deepEqual(catalog.extraKeysForProduct('Шаурма с говядиной','Шаурма'),['beef','cheese-stick','garlic']);
  assert.deepEqual(catalog.extraKeysForProduct('Хот-дог Итали','Хот-Доги'),['cheddar','onion','cheese-sauce']);
  const shrimp=catalog.extraKeysForProduct('Шаурма с королевской креветкой','Шаурма');
  assert.deepEqual(shrimp,['shrimp','caesar','garlic']);
  assert.equal(shrimp.includes('jalapeno'),false);
});
test('extras are limited to food categories, not drinks',()=>{
  for (const category of ['Бургеры','Шаурма','Хот-доги','Горячие закуски']) assert.equal(catalog.acceptsExtras(category),true);
  for (const category of ['Напитки','Соусы','']) assert.equal(catalog.acceptsExtras(category),false);
});
test('disposable PostgreSQL: logical extras install idempotently with quantity capped at three',{
  skip:process.env.YOOKASSA_AUDIT_LOCAL_DSN?false:'Requires disposable local database'
},async()=>{
  const dsn=process.env.YOOKASSA_AUDIT_LOCAL_DSN;
  assert.equal(dsn,'postgres://postgres@127.0.0.1:55439/karimoff_audit');
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('fixture rollback');
  try {
    await sql.begin(async tx=>{
      await tx`update products set is_active=false`;
      for(const extra of catalog.extrasCatalog.filter(e=>e.key!=='jalapeno')) {
        await tx`insert into ingredients(name,unit,cost_per_unit,waste_percent,is_active)
          select ${extra.name},${extra.unit},1,0,true where not exists(select 1 from ingredients where name=${extra.name})`;
      }
      await tx`insert into products(name,slug,category,price,is_active) values('Доп тест','extras-fixture','Бургеры',250,true) on conflict(slug) do nothing`;
      await tx`update products set is_active=true where slug='extras-fixture'`;
      await tx`insert into product_ingredients(product_id,ingredient_id,quantity,unit,is_extra_available,extra_quantity,extra_price,max_extra_quantity)
        select p.id,i.id,0,i.unit,true,1,160,3 from products p cross join ingredients i
        where p.slug='extras-fixture' and i.name='Колбаска говяжья'
          and not exists(select 1 from product_ingredients pi where pi.product_id=p.id and pi.ingredient_id=i.id)`;
      const [before]=await tx`select count(*)::int as recipes from product_ingredients`;
      const service=compile('src/lib/extras-service.ts',{'server-only':{},'node:crypto':{createHash},'./extras-catalog':catalog,'@/lib/postgres/server':{getPostgresSql:()=>Object.assign((...args)=>tx(...args),{begin:cb=>cb(tx)})}});
      const first=await service.installExtrasCatalog();
      assert.ok(first.added>=3);
      assert.equal(first.configured,3);
      assert.equal((await service.installExtrasCatalog()).added,0);
      const rows=await service.listExtrasCatalog();
      assert.equal(rows.length,3);
      const patty=rows.find(r=>r.name==='Котлета говяжья');
      await service.changeExtraPrice(patty.ingredient_id,patty.label,210);
      await service.installExtrasCatalog();
      const reread=(await service.listExtrasCatalog()).find(r=>r.name==='Котлета говяжья');
      assert.equal(Number(reread.price),210);
      assert.equal(Number(reread.price_max),210);
      const limits=await tx`select max_extra_quantity from product_ingredients where product_id=(select id from products where slug='extras-fixture') and is_extra_available`;
      assert.equal(limits.length,3);
      assert.ok(limits.every(row=>row.max_extra_quantity===3));
      const [retired]=await tx`select is_extra_available from product_ingredients pi join ingredients i on i.id=pi.ingredient_id
        where pi.product_id=(select id from products where slug='extras-fixture') and i.name='Колбаска говяжья'`;
      assert.equal(retired.is_extra_available,false);
      const [after]=await tx`select count(*)::int as recipes from product_ingredients`;
      assert.equal(after.recipes,before.recipes+3);
      throw rollback;
    });
  } catch(e) {if(e!==rollback) throw e;} finally {await sql.end();}
});
