import "server-only";
import { createHash } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";
import { acceptsExtras, extraKeysForProduct, extrasCatalog, extrasGroupName } from "./extras-catalog";

export function extraRecordId(value: string) {
  const hex = createHash("sha256").update(`karimoff-extras-v1:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function installExtrasCatalog() {
  return getPostgresSql().begin(async sql => {
    await sql`select pg_advisory_xact_lock(hashtext('karimoff-extras-v1'))`;
    const products = (await sql<{ id: string; name: string; category: string }[]>`select id, name, category from products where is_active order by id`).filter(p => acceptsExtras(p.category));
    if (!products.length) throw new Error("Нет активных блюд для добавок.");
    // Only this missing ingredient is introduced. Its unknown purchase price is not fabricated.
    await sql`insert into ingredients (id,name,unit,cost_per_unit,waste_percent,is_active,sort_order)
      select ${extraRecordId("jalapeno-ingredient")}::uuid, 'Халапеньо', 'g', 0, 0, true, 365
      where not exists(select 1 from ingredients where name = 'Халапеньо') on conflict(id) do nothing`;
    const ingredients = await sql<{ id: string; name: string; unit: string }[]>`select id,name,unit from ingredients where is_active`;
    const requiredKeys = new Set(products.flatMap(product => extraKeysForProduct(product.name, product.category)));
    const resolved = extrasCatalog.filter(extra => requiredKeys.has(extra.key)).map(extra => {
      const matches = ingredients.filter(i => i.name === extra.name && i.unit === extra.unit);
      if (matches.length !== 1) throw new Error(`Проверьте ингредиент: ${extra.name}.`);
      return { ...extra, ingredientId: matches[0].id };
    });
    await sql`update product_modifier_groups set is_active=false, updated_at=now()
      where name=${extrasGroupName} and product_id=any(${products.map(product => product.id)}::uuid[])`;
    await sql`update product_ingredients set is_extra_available=false
      where product_id=any(${products.map(product => product.id)}::uuid[]) and is_extra_available`;
    let added = 0;
    let configured = 0;
    for (const product of products) {
      const keys = extraKeysForProduct(product.name, product.category);
      for (const [index, key] of keys.entries()) {
        const extra = resolved.find(item => item.key === key);
        if (!extra) throw new Error(`Проверьте доп для блюда ${product.name}: ${key}.`);
        const [existing] = await sql<{ id: string; extra_price: string }[]>`select id,extra_price::text from product_ingredients
          where product_id=${product.id}::uuid and ingredient_id=${extra.ingredientId}::uuid order by sort_order,id limit 1`;
        const [saved] = await sql<{ price_delta: string }[]>`select o.price_delta::text from product_modifier_options o
          join product_modifier_groups g on g.id=o.group_id where g.name=${extrasGroupName}
          and o.ingredient_id=${extra.ingredientId}::uuid order by o.created_at limit 1`;
        const price = Number(existing?.extra_price) > 0 ? Number(existing.extra_price) : Number(saved?.price_delta) > 0 ? Number(saved.price_delta) : extra.price;
        if (existing) {
          await sql`update product_ingredients set is_extra_available=true,extra_quantity=${extra.quantity},extra_price=${price},
            max_extra_quantity=3,sort_order=${900 + index * 10} where id=${existing.id}::uuid`;
        } else {
          const inserted = await sql`insert into product_ingredients(id,product_id,ingredient_id,quantity,unit,sort_order,is_removable,
            is_extra_available,extra_quantity,extra_price,max_extra_quantity)
            values(${extraRecordId(`recipe:${product.id}:${extra.key}`)}::uuid,${product.id}::uuid,${extra.ingredientId}::uuid,0,
              ${extra.unit},${900 + index * 10},false,true,${extra.quantity},${price},3)
            on conflict(id) do update set is_extra_available=true,extra_quantity=excluded.extra_quantity,
              extra_price=excluded.extra_price,max_extra_quantity=3,sort_order=excluded.sort_order returning id`;
          added += inserted.length;
        }
        configured += 1;
      }
    }
    return { products: products.length, configured, added };
  });
}

export async function listExtrasCatalog() {
  return getPostgresSql()<{
    ingredient_id: string; name: string; label: string; unit: string; price: string; price_max: string;
    quantity: string; cost: string; waste: string; product_count: number; note: string | null;
  }[]>`select pi.ingredient_id,i.name,i.name as label,pi.unit,min(pi.extra_price)::text as price,max(pi.extra_price)::text as price_max,
    min(pi.extra_quantity)::text as quantity,i.cost_per_unit::text as cost,i.waste_percent::text as waste,
    count(distinct pi.product_id)::int as product_count,null::text as note
    from product_ingredients pi join ingredients i on i.id=pi.ingredient_id
    where pi.is_extra_available and i.is_active
    group by pi.ingredient_id,i.name,pi.unit,i.cost_per_unit,i.waste_percent order by min(pi.sort_order)`;
}

export async function changeExtraPrice(ingredientId: string, _label: string, price: number) {
  return getPostgresSql()`update product_ingredients set extra_price=${price}
    where ingredient_id=${ingredientId}::uuid and is_extra_available returning id`;
}
