export const PRODUCT_FOOD_COST_CTE = `
  product_food_costs as (
    select
      recipe.product_id,
      count(*) > 0
        and bool_and(coalesce(
          ingredient.cost_per_unit > 0
          and recipe.unit = ingredient.unit
          and recipe.quantity >= 0,
          false
        )) as is_complete,
      sum(
        recipe.quantity
        / (1 - least(95, greatest(0, coalesce(ingredient.waste_percent, 0))) / 100)
        * ingredient.cost_per_unit
      )::numeric as unit_food_cost
    from public.product_ingredients recipe
    left join public.ingredients ingredient on ingredient.id = recipe.ingredient_id
    group by recipe.product_id
  )
`;

// Item source stays "web" for native POS/kiosk orders even when the sale channel is "pos_evotor".
// Snapshot quantities already include waste; only the current ingredient price is applied here.
export const SALE_FOOD_COST_JOIN = `
  left join product_food_costs base_product_cost
    on i.source = 'pos_evotor'
   and i.mapping_status = 'confirmed'
   and base_product_cost.product_id = i.product_id
  left join lateral (
    select
      count(*) > 0 and bool_and(coalesce(
        ingredient.cost_per_unit > 0
        and usage.unit = ingredient.unit
        and usage.quantity_per_item >= 0,
        false
      )) as is_complete,
      sum(usage.quantity_per_item * ingredient.cost_per_unit)::numeric as unit_food_cost
    from public.order_item_ingredient_usage usage
    left join public.ingredients ingredient on ingredient.id = usage.ingredient_id
    where i.source = 'web'
      and usage.order_item_id = i.source_record_id
  ) snapshot_cost on true
  left join lateral (
    select resolved.unit_food_cost, resolved.unit_food_cost is not null as is_complete
    from (
      select case
        when i.source = 'web' then
          case when snapshot_cost.is_complete then snapshot_cost.unit_food_cost end
        when i.source = 'pos_evotor'
          and i.mapping_status = 'confirmed'
          and base_product_cost.is_complete
          and not exists (
            select 1
            from public.product_modifier_groups portion_group
            where portion_group.product_id = i.product_id
              and portion_group.name = 'Размер порции'
          ) then base_product_cost.unit_food_cost
        else null
      end::numeric as unit_food_cost
    ) resolved
  ) product_cost on true
`;
