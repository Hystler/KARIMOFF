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
test('extras cover all requested portions, distinct sauces and sausages',()=>{
  assert.equal(catalog.extrasCatalog.length,20);
  assert.equal(new Set(catalog.extrasCatalog.map(e=>e.key)).size,20);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='fries').quantity,50);
  assert.equal(catalog.extrasCatalog.find(e=>e.key==='patty').quantity,110);
  assert.equal(catalog.extrasCatalog.filter(e=>e.key.startsWith('sausage-')).length,3);
  assert.ok(catalog.extrasCatalog.every(e=>e.price>0 && e.quantity>0));
});
test('extras are limited to food categories, not drinks',()=>{
  for (const category of ['Бургеры','Шаурма','Хот-доги','Горячие закуски']) assert.equal(catalog.acceptsExtras(category),true);
  for (const category of ['Напитки','Соусы','']) assert.equal(catalog.acceptsExtras(category),false);
});
test('disposable PostgreSQL: install, idempotent reread, central price and unchanged recipes',{
  skip:process.env.YOOKASSA_AUDIT_LOCAL_DSN?false:'Requires disposable local database'
},async()=>{
  const dsn=process.env.YOOKASSA_AUDIT_LOCAL_DSN;
  assert.equal(dsn,'postgres://postgres@127.0.0.1:55439/karimoff_audit');
  const sql=postgres(dsn,{max:1,onnotice(){}});
  const rollback=new Error('fixture rollback');
  try {
    await sql.begin(async tx=>{
      for(const extra of catalog.extrasCatalog.filter(e=>e.key!=='jalapeno')) {
        await tx`insert into ingredients(name,unit,cost_per_unit,waste_percent,is_active)
          select ${extra.name},${extra.unit},1,0,true where not exists(select 1 from ingredients where name=${extra.name})`;
      }
      await tx`insert into products(name,slug,category,price,is_active) values('Доп тест','extras-fixture','Бургеры',250,true) on conflict(slug) do nothing`;
      const [before]=await tx`select count(*)::int as recipes from product_ingredients`;
      const service=compile('src/lib/extras-service.ts',{'server-only':{},'node:crypto':{createHash},'./extras-catalog':catalog,'@/lib/postgres/server':{getPostgresSql:()=>Object.assign((...args)=>tx(...args),{begin:cb=>cb(tx)})}});
      const first=await service.installExtrasCatalog();
      assert.ok(first.added>=20);
      assert.equal((await service.installExtrasCatalog()).added,0);
      const rows=await service.listExtrasCatalog();
      assert.equal(rows.length,20);
      const fries=rows.find(r=>r.name==='Картофель фри');
      await service.changeExtraPrice(fries.ingredient_id,fries.label,55);
      await service.installExtrasCatalog();
      const reread=(await service.listExtrasCatalog()).find(r=>r.name==='Картофель фри');
      assert.equal(Number(reread.price),55);
      assert.equal(Number(reread.price_max),55);
      assert.equal(Number(rows.find(r=>r.name==='Халапеньо').cost),0);
      const [after]=await tx`select count(*)::int as recipes from product_ingredients`;
      assert.deepEqual(after,before);
      throw rollback;
    });
  } catch(e) {if(e!==rollback) throw e;} finally {await sql.end();}
});
