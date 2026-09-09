import "server-only";
import { createHash } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";
import { acceptsExtras, extrasCatalog, extrasGroupName } from "./extras-catalog";

export function extraRecordId(value: string) {
  const hex = createHash("sha256").update(`karimoff-extras-v1:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function installExtrasCatalog() {
  return getPostgresSql().begin(async sql => {
    await sql`select pg_advisory_xact_lock(hashtext('karimoff-extras-v1'))`;
    const products = (await sql<{ id: string; category: string }[]>`select id, category from products where is_active order by id`).filter(p => acceptsExtras(p.category));
    if (!products.length) throw new Error("Нет активных блюд для добавок.");
    // Only this missing ingredient is introduced. Its unknown purchase price is not fabricated.
    await sql`insert into ingredients (id,name,unit,cost_per_unit,waste_percent,is_active,sort_order)
      select ${extraRecordId("jalapeno-ingredient")}::uuid, 'Халапеньо', 'g', 0, 0, true, 365
      where not exists(select 1 from ingredients where name = 'Халапеньо') on conflict(id) do nothing`;
    const ingredients = await sql<{ id: string; name: string; unit: string }[]>`select id,name,unit from ingredients where is_active`;
    const resolved = extrasCatalog.map(extra => {
      const matches = ingredients.filter(i => i.name === extra.name && i.unit === extra.unit);
      if (matches.length !== 1) throw new Error(`Проверьте ингредиент: ${extra.name}.`);
      return { ...extra, ingredientId: matches[0].id };
    });
    let added = 0;
    for (const product of products) {
      const groupId = extraRecordId(`group:${product.id}`);
      await sql`insert into product_modifier_groups(id,product_id,name,selection_type,min_selections,max_selections,sort_order)
        values(${groupId}::uuid,${product.id}::uuid,${extrasGroupName},'multi',0,20,900) on conflict(id) do nothing`;
      for (const [index, extra] of resolved.entries()) {
        // An existing edited price/portion is preserved, also when adding the catalog to new products.
        const [saved] = await sql`select o.price_delta,o.quantity_delta,o.kitchen_note from product_modifier_options o
          join product_modifier_groups g on g.id=o.group_id where g.name=${extrasGroupName}
          and o.ingredient_id=${extra.ingredientId}::uuid and o.label=${extra.label} order by o.created_at limit 1`;
        const inserted = await sql`insert into product_modifier_options(id,group_id,label,modifier_type,ingredient_id,quantity_delta,unit,price_delta,kitchen_note,sort_order)
          values(${extraRecordId(`${product.id}:${extra.key}`)}::uuid,${groupId}::uuid,${extra.label},'add',${extra.ingredientId}::uuid,
            ${saved?.quantity_delta ?? extra.quantity},${extra.unit},${saved?.price_delta ?? extra.price},
            ${saved?.kitchen_note ?? ("note" in extra ? extra.note : null)},${index * 10}) on conflict(id) do nothing returning id`;
        added += inserted.length;
      }
    }
    return { products: products.length, added };
  });
}

export async function listExtrasCatalog() {
  return getPostgresSql()<{
    ingredient_id: string; name: string; label: string; unit: string; price: string; price_max: string;
    quantity: string; cost: string; waste: string; product_count: number; note: string | null;
  }[]>`select o.ingredient_id,i.name,o.label,o.unit,min(o.price_delta)::text as price,max(o.price_delta)::text as price_max,
    min(o.quantity_delta)::text as quantity,i.cost_per_unit::text as cost,i.waste_percent::text as waste,
    count(distinct g.product_id)::int as product_count,min(o.kitchen_note) as note
    from product_modifier_options o join product_modifier_groups g on g.id=o.group_id join ingredients i on i.id=o.ingredient_id
    where g.name=${extrasGroupName} and g.is_active and o.is_active
    group by o.ingredient_id,i.name,o.label,o.unit,i.cost_per_unit,i.waste_percent order by min(o.sort_order)`;
}

export async function changeExtraPrice(ingredientId: string, label: string, price: number) {
  return getPostgresSql()`update product_modifier_options o set price_delta=${price}
    from product_modifier_groups g where g.id=o.group_id and g.name=${extrasGroupName}
    and o.ingredient_id=${ingredientId}::uuid and o.label=${label} returning o.id`;
}
