import "server-only";
import { randomUUID } from "node:crypto";
import { getPostgresSql } from "./postgres/server";
import { formatServing, PORTION_GROUP_NAME } from "./product-serving";

export async function saveProductPortions(productId: string, portions: Array<{ quantity: number; price: number }>) {
  if (portions.length < 2 || portions.length > 4 || portions.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price <= 0 || item.price > 100000)
    || new Set(portions.map(item => item.quantity)).size !== portions.length) throw new Error("Некорректные порции");
  const sorted = [...portions].sort((a, b) => a.quantity - b.quantity);
  if (sorted.some(item => item.price < sorted[0].price)) throw new Error("Цена большей порции не может быть ниже базовой");
  return getPostgresSql().begin(async sql => {
    const [product] = await sql`select id,price,weight from products where id=${productId}::uuid for update`;
    if (!product) throw new Error("Товар не найден");
    const lines = await sql`select pi.id,pi.ingredient_id,pi.quantity,pi.unit,pi.is_removable,i.unit as ingredient_unit from product_ingredients pi
      join ingredients i on i.id=pi.ingredient_id where pi.product_id=${productId}::uuid for update of pi`;
    if (lines.length !== 1 || lines[0].unit !== lines[0].ingredient_unit) throw new Error("Для порций нужна одна основная строка рецептуры с согласованными единицами");
    const line = lines[0];
    if (line.unit === "pcs" && sorted.some(item => !Number.isInteger(item.quantity))) throw new Error("Укажите целое количество штук");
    const groups = await sql`select id from product_modifier_groups where product_id=${productId}::uuid and name=${PORTION_GROUP_NAME} for update`;
    if (groups.length > 1) throw new Error("Обнаружены повторяющиеся группы порций");
    const groupId = groups[0]?.id ?? randomUUID();
    await sql`insert into product_modifier_groups(id,product_id,name,selection_type,min_selections,max_selections,sort_order)
      values(${groupId}::uuid,${productId}::uuid,${PORTION_GROUP_NAME},'single',1,1,0)
      on conflict(id) do update set is_active=true,selection_type='single',min_selections=1,max_selections=1,sort_order=0`;
    const options = await sql`select id,label,quantity_delta from product_modifier_options where group_id=${groupId}::uuid for update`;
    const activeIds: string[] = [];
    for (const [index, portion] of sorted.entries()) {
      const existing = options.find(option => Number(option.quantity_delta) === portion.quantity);
      const id = existing?.id ?? randomUUID();
      activeIds.push(id);
      const label = formatServing(portion.quantity, line.unit);
      // A replacement with the same ingredient changes the recipe snapshot to the selected serving.
      await sql`insert into product_modifier_options(id,group_id,label,modifier_type,ingredient_id,replacement_ingredient_id,quantity_delta,unit,price_delta,kitchen_note,is_default,sort_order)
        values(${id}::uuid,${groupId}::uuid,${label},'replace',${line.ingredient_id}::uuid,${line.ingredient_id}::uuid,${portion.quantity},${line.unit},
          ${(Math.round(portion.price * 100) - Math.round(sorted[0].price * 100)) / 100},${`Порция: ${label}`},false,${index})
        on conflict(id) do update set label=excluded.label,modifier_type='replace',ingredient_id=excluded.ingredient_id,
          replacement_ingredient_id=excluded.replacement_ingredient_id,quantity_delta=excluded.quantity_delta,unit=excluded.unit,
          price_delta=excluded.price_delta,kitchen_note=excluded.kitchen_note,is_default=false,is_active=true,sort_order=excluded.sort_order`;
    }
    await sql`update product_modifier_options set is_active=false where group_id=${groupId}::uuid and not(id=any(${activeIds}::uuid[]))`;
    await sql`update products set price=${sorted[0].price},weight=${formatServing(sorted[0].quantity,line.unit)} where id=${productId}::uuid`;
    // The canonical engine uses this flag for both remove and replace. The required
    // portion group prevents selling the ingredient-less variant (conflicting changes are rejected).
    await sql`update product_ingredients set quantity=${sorted[0].quantity},is_removable=true where id=${line.id}::uuid`;
    return { productId, previousBase: { price: product.price, weight: product.weight, quantity: line.quantity, isRemovable: line.is_removable }, portions: sorted };
  });
}
