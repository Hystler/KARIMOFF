import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const serving = loadTypeScript('src/lib/product-serving.ts');
const imported = loadTypeScript('src/lib/product-portions.ts');
const nutrition = loadTypeScript('src/lib/product-nutrition.ts');
const reference = loadTypeScript('src/lib/ingredient-nutrition.ts');
const categories = loadTypeScript('src/lib/product-categories.ts');
const line = { ingredient_id:'n', name:'Наггетсы', quantity:6, unit:'pcs', sort_order:0,
  nutrition_basis_quantity:1, calories_kcal:40, proteins_g:2, fats_g:2, carbohydrates_g:3 };
const option = { id:'large',label:'12 шт.', modifier_type:'replace',ingredient_id:'n',replacement_ingredient_id:'n',quantity_delta:12,unit:'pcs',price_delta:180 };
const product = { weight:'12/6 ед.', modifier_groups:[{ id:'size',name:serving.PORTION_GROUP_NAME,selection_type:'single',min_selections:1,max_selections:1,options:[option,{...option,id:'small',label:'6 шт.',quantity_delta:6,price_delta:0}] }] };
const custom = { removed:[],extras:[],modifierOptionIds:['large'] };

test('servings use one unit notation and never advertise unsupported text ranges',()=>{
  for(const value of ['1 ед.','1 единица','1 шт']) assert.equal(serving.normalizeServing(value),'1 шт.');
  assert.equal(serving.normalizeServing('300 гр'),'300 г');
  for(const value of ['6/12 ед.','12/6 шт.','6-18 ед.','0 г','Infinity г']) assert.equal(serving.normalizeServing(value),null);
  assert.equal(serving.getServingLabel(product),'6 шт. или 12 шт.');
  assert.equal(serving.getServingLabel(product,['large']),'12 шт.');
  assert.equal(serving.getServingLabel({weight:'1 шт.',category:'Бургеры',modifier_groups:[]}),null);
  assert.equal(serving.getServingLabel({weight:'1 ед.',category:'Шаурма',modifier_groups:[]}),null);
  assert.equal(serving.getServingLabel({weight:'300 гр',category:'Шаурма',modifier_groups:[]}),'300 г');
  assert.equal(serving.getServingLabel({weight:'6 ед.',category:'Горячие закуски',modifier_groups:[]}),'6 шт.');
  assert.equal(serving.getServingLabel({weight:'12/6 ед.',category:'Горячие закуски',modifier_groups:[]}),null);
});
test('historical portion prices come from menu export, unknown products are not guessed',()=>{
  assert.deepEqual(imported.getImportedPortions('naggetsy').map(p=>[p.quantity,p.price]),[[6,210],[12,390]]);
  assert.deepEqual(imported.getProductAliases('naggetsy'),['naggetsy-6-sht','naggetsy']);
  assert.deepEqual(imported.getImportedPortions('unlisted'),[]);
});
test('public menu rejects every recognized drinks category',()=>{
  for (const category of ['Напитки','напитки','Drinks','Лимонады','Кола']) {
    assert.equal(categories.isPublicMenuCategory(category),false,category);
  }
  for (const category of ['Бургеры','Шаурма','Горячие закуски','Соусы']) {
    assert.equal(categories.isPublicMenuCategory(category),true,category);
  }
});
test('selected portion replaces the base quantity, removal and extra quantities are respected',()=>{
  const value=nutrition.getCustomizedNutrition(product,[line],[],custom);
  assert.equal(value.complete,true);
  assert.equal(value.items[0].value,480);
  const withExtra={...product,modifier_options:[{ingredient_id:'n',extra_quantity:1,unit:'pcs'}]};
  assert.equal(nutrition.getCustomizedNutrition(withExtra,[line],[],{...custom,extras:[{ingredient_id:'n',quantity:2}]}).items[0].value,560);
  assert.equal(nutrition.getCustomizedNutrition({},[line],[],{...custom,removed:[{ingredient_id:'n'}],modifierOptionIds:[]}).available,false);
});
test('missing modifier nutrition and mismatched units never produce a false complete value',()=>{
  for(const change of [{replacement_ingredient_id:'unknown'},{unit:'g'}]) {
    const changed={...product,modifier_groups:[{...product.modifier_groups[0],options:[{...option,...change}]}]};
    assert.equal(nutrition.getCustomizedNutrition(changed,[line],[],custom).complete,false);
  }
  for(const change of [{quantity:NaN},{quantity:0},{calories_kcal:Infinity},{fats_g:-1},{nutrition_basis_quantity:0}]) {
    assert.equal(nutrition.calculateRecipeNutrition([{...line,...change}]).complete,false);
  }
});
test('reference nutrition is exact-name, unit-aware and never overrides partial or entered data',()=>{
  const cabbage={...line,name:'Капуста',unit:'g',quantity:100,nutrition_basis_quantity:100,calories_kcal:null,proteins_g:null,fats_g:null,carbohydrates_g:null};
  assert.equal(reference.getIngredientNutritionReference(cabbage).sourceFoodId,2346407);
  assert.equal(nutrition.calculateRecipeNutrition([cabbage]).items[0].value,27.9);
  const bun={...cabbage,name:'Булочка для бургера белая',unit:'pcs',quantity:1,nutrition_basis_quantity:1};
  assert.equal(nutrition.calculateRecipeNutrition([bun]).items[0].value,213.2);
  for(const change of [{name:'Капуста для проверки'},{unit:'pcs'},{calories_kcal:0},{calories_kcal:undefined}]) assert.equal(reference.getIngredientNutritionReference({...cabbage,...change}),undefined);
  const invalid={...cabbage,nutrition_basis_quantity:0};
  assert.equal(nutrition.calculateRecipeNutrition([invalid]).complete,false);
});
test('temporary prepared-food references use the confirmed production piece weights',()=>{
  const empty=(name,unit)=>({...line,name,unit,quantity:1,nutrition_basis_quantity:unit==='pcs'?1:100,calories_kcal:null,proteins_g:null,fats_g:null,carbohydrates_g:null});
  const calories=(name,unit)=>reference.getIngredientNutritionReference(empty(name,unit)).calories_kcal;
  assert.equal(calories('Лаваш','pcs'),200.75);
  assert.equal(calories('Бекон жареный','pcs'),16.23);
  assert.equal(calories('Крыло куриное Барбекю','pcs'),147.66);
  assert.equal(calories('Королевская креветка в панировке','pcs'),58.52);
  assert.equal(calories('Соус медово-горчичный','g'),464);
  assert.equal(calories('Соус чесночный','g'),526.63);
  assert.equal(calories('Тортилья','g'),320);
  assert.equal(calories('Соус барбекю обычный','g'),120);
});
test('disposable PG: portion setup idempotency, server price and recipe/food-cost snapshot',{
  skip:process.env.YOOKASSA_AUDIT_LOCAL_DSN?false:'Requires disposable local database'
},async()=>{
  assert.equal(process.env.YOOKASSA_AUDIT_LOCAL_DSN,'postgres://postgres@127.0.0.1:55439/karimoff_audit');
  const sql=postgres(process.env.YOOKASSA_AUDIT_LOCAL_DSN,{max:1,onnotice(){}});
  const rollback=new Error('fixture rollback');
  try {
    await sql.begin(async tx=>{
      const [p]=await tx`insert into products(name,slug,category,price,weight,is_active) values('Порции тест',${randomUUID()},'Горячие закуски',390,'12/6 ед.',true) returning id`;
      const [i]=await tx`insert into ingredients(name,unit,cost_per_unit,waste_percent) values('Наггетсы тест','pcs',14.4,0) returning id`;
      await tx`insert into product_ingredients(product_id,ingredient_id,quantity,unit) values(${p.id},${i.id},12,'pcs')`;
      const service=loadTypeScript('src/lib/product-portions-service.ts',{'server-only':{},'node:crypto':{randomUUID},'./postgres/server':{getPostgresSql:()=>({begin:cb=>cb(tx)})}});
      const portions=[{quantity:12,price:390},{quantity:6,price:210}];
      await service.saveProductPortions(p.id,portions);
      const first=await tx`select o.id,o.quantity_delta,o.price_delta from product_modifier_options o join product_modifier_groups g on g.id=o.group_id where g.product_id=${p.id} order by o.quantity_delta`;
      await service.saveProductPortions(p.id,portions);
      const second=await tx`select o.id,o.quantity_delta,o.price_delta from product_modifier_options o join product_modifier_groups g on g.id=o.group_id where g.product_id=${p.id} order by o.quantity_delta`;
      assert.deepEqual(second,first);
      const [base]=await tx`select p.price,p.weight,pi.quantity from products p join product_ingredients pi on pi.product_id=p.id where p.id=${p.id}`;
      assert.equal(Number(base.price),210); assert.equal(base.weight,'6 шт.'); assert.equal(Number(base.quantity),6);
      const [location]=await tx`select id from order_locations where is_active limit 1`;
      for (const [index,size] of first.entries()) {
        const [created]=await tx`select * from create_pos_order_atomic(${location.id}::uuid,'Порция тест'::text,null::text,
          ${tx.json([{product_id:p.id,quantity:1,modifier_option_ids:[size.id]}])}::jsonb,${randomUUID()}::uuid,null::uuid,'owner'::text,'asap'::text,null::timestamptz,true,null::uuid)`;
        const [snapshot]=await tx`select oi.unit_price,u.quantity_per_item,(u.quantity_per_item*i.cost_per_unit) as cost
          from order_items oi join order_item_ingredient_usage u on u.order_item_id=oi.id join ingredients i on i.id=u.ingredient_id where oi.order_id=${created.order_id}`;
        assert.equal(Number(snapshot.unit_price),index===0?210:390);
        assert.equal(Number(snapshot.quantity_per_item),index===0?6:12);
        assert.equal(Number(snapshot.cost),index===0?86.4:172.8);
      }
      // Canonical validation rejects omitted required portion, not an implicit base-size sale.
      await assert.rejects(tx.savepoint(async inner=>inner`select * from create_pos_order_atomic(${location.id}::uuid,'Порция тест'::text,null::text,
        ${inner.json([{product_id:p.id,quantity:1}])}::jsonb,${randomUUID()}::uuid,null::uuid,'owner'::text,'asap'::text,null::timestamptz,true,null::uuid)`));
      await assert.rejects(tx.savepoint(async inner=>inner`select * from create_pos_order_atomic(${location.id}::uuid,'Порция тест'::text,null::text,
        ${inner.json([{product_id:p.id,quantity:1,modifier_option_ids:[first[0].id],removed_ingredient_ids:[i.id]}])}::jsonb,
        ${randomUUID()}::uuid,null::uuid,'owner'::text,'asap'::text,null::timestamptz,true,null::uuid)`),/несовместимыми/);
      throw rollback;
    });
  } catch(error){if(error!==rollback)throw error;} finally {await sql.end();}
});
