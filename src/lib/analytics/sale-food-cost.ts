import { EVOTOR_FOOD_COST_IDENTITIES_CTE } from "./evotor-food-cost-identities";

export const PRODUCT_FOOD_COST_CTE = `
  ${EVOTOR_FOOD_COST_IDENTITIES_CTE},
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
  left join public.evotor_receipt_items cost_receipt_item
    on i.source = 'pos_evotor' and cost_receipt_item.id = i.source_record_id
  left join public.evotor_receipts cost_receipt on cost_receipt.id = cost_receipt_item.receipt_id
  left join public.evotor_stores cost_store on cost_store.id = cost_receipt.store_id
  left join evotor_food_cost_identities cost_identity
    on cost_identity.sku = cost_receipt_item.evotor_product_id
   and cost_identity.store_id = cost_store.evotor_store_id
  left join public.products identity_product on identity_product.slug = cost_identity.product_slug
  left join product_food_costs identity_recipe on identity_recipe.product_id = identity_product.id
  left join public.ingredients identity_ingredient on identity_ingredient.id = cost_identity.ingredient_id
  left join lateral (
    select count(*) = 1 and bool_and(original_ingredient.cost_per_unit > 0
      and recipe.unit = original_ingredient.unit and recipe.quantity >= 0) as is_complete,
      sum(recipe.quantity
        / (1 - least(95, greatest(0, coalesce(original_ingredient.waste_percent, 0))) / 100)
        * original_ingredient.cost_per_unit) as unit_food_cost
    from public.product_ingredients recipe
    join public.ingredients original_ingredient on original_ingredient.id = recipe.ingredient_id
    where recipe.product_id = identity_product.id
      and recipe.ingredient_id = cost_identity.original_ingredient_id
  ) original_component on true
  left join lateral (
    select coalesce(
      lower(trim(cost_receipt_item.name)) = any(cost_identity.names)
      and i.mapping_status <> 'rejected'
      and cost_receipt.closed_at >= cost_identity.valid_from
      and coalesce(cost_receipt_item.raw_metadata->'sub_positions', '[]'::jsonb) = '[]'::jsonb
      and coalesce(cost_receipt_item.raw_metadata->'extra_keys', '[]'::jsonb) = '[]'::jsonb,
      false
    ) as is_valid
  ) identity_proof on true
  left join lateral (
    select case when identity_proof.is_valid then case
      when cost_identity.kind = 'recipe' and identity_recipe.is_complete
        and i.mapping_status <> 'rejected'
        and (i.product_id is null or i.product_id = identity_product.id)
        and not exists (
          select 1 from public.product_modifier_groups identity_group
          join public.product_modifier_options identity_option on identity_option.group_id = identity_group.id
          where identity_group.product_id = identity_product.id and identity_option.modifier_type = 'replace'
        ) then identity_recipe.unit_food_cost
      when cost_identity.kind = 'replacement' and identity_recipe.is_complete
        and original_component.is_complete
        and identity_ingredient.cost_per_unit > 0 and identity_ingredient.unit = cost_identity.unit
        and i.mapping_status = 'confirmed' and i.product_id = identity_product.id
        and exists (
          select 1 from public.product_modifier_groups identity_group
          join public.product_modifier_options identity_option on identity_option.group_id = identity_group.id
          where identity_group.product_id = identity_product.id
            and identity_option.modifier_type = 'replace'
            and identity_option.ingredient_id = cost_identity.original_ingredient_id
            and identity_option.replacement_ingredient_id = cost_identity.ingredient_id
            and identity_option.quantity_delta = cost_identity.quantity
            and identity_option.unit = cost_identity.unit
        ) then identity_recipe.unit_food_cost - original_component.unit_food_cost
          + cost_identity.quantity
            / (1 - least(95, greatest(0, coalesce(identity_ingredient.waste_percent, 0))) / 100)
            * identity_ingredient.cost_per_unit
      when cost_identity.kind in ('portion', 'component')
        and identity_ingredient.cost_per_unit > 0
        and identity_ingredient.unit = cost_identity.unit
        and ((cost_identity.kind = 'component' and i.product_id is null) or (
          i.mapping_status = 'confirmed' and i.product_id = identity_product.id
          and exists (
            select 1 from public.product_ingredients portion_recipe
            where portion_recipe.product_id = identity_product.id
              and portion_recipe.ingredient_id = cost_identity.ingredient_id
              and portion_recipe.unit = cost_identity.unit
          )
          and not exists (
            select 1 from public.product_ingredients portion_recipe
            where portion_recipe.product_id = identity_product.id
              and portion_recipe.ingredient_id <> cost_identity.ingredient_id
              and portion_recipe.quantity <> 0
          )
          and exists (
            select 1 from public.product_modifier_groups identity_group
            join public.product_modifier_options identity_option on identity_option.group_id = identity_group.id
            where identity_group.product_id = identity_product.id
              and identity_group.name = 'Размер порции'
              and identity_option.modifier_type = 'replace'
              and coalesce(identity_option.replacement_ingredient_id, identity_option.ingredient_id) = cost_identity.ingredient_id
              and identity_option.quantity_delta = cost_identity.quantity
              and identity_option.unit = cost_identity.unit
          )
        )) then cost_identity.quantity
          / (1 - least(95, greatest(0, coalesce(identity_ingredient.waste_percent, 0))) / 100)
          * identity_ingredient.cost_per_unit
    end end::numeric as unit_food_cost
  ) identity_cost on true
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
    select resolved.unit_food_cost, resolved.unit_food_cost is not null as is_complete,
      (i.mapping_status in ('native', 'confirmed') or identity_proof.is_valid) as is_mapped
    from (
      select case
        when i.source = 'web' then
          case when snapshot_cost.is_complete then snapshot_cost.unit_food_cost end
        when i.source = 'pos_evotor' and cost_identity.sku is not null then identity_cost.unit_food_cost
        when i.source = 'pos_evotor'
          and i.mapping_status = 'confirmed'
          and base_product_cost.is_complete
          and coalesce(cost_receipt_item.raw_metadata->'sub_positions', '[]'::jsonb) = '[]'::jsonb
          and coalesce(cost_receipt_item.raw_metadata->'extra_keys', '[]'::jsonb) = '[]'::jsonb
          and not exists (
            select 1
            from public.product_modifier_groups variant_group
            left join public.product_modifier_options variant_option on variant_option.group_id = variant_group.id
            where variant_group.product_id = i.product_id
              and (variant_group.name = 'Размер порции' or variant_option.modifier_type = 'replace')
          ) then base_product_cost.unit_food_cost
        else null
      end::numeric as unit_food_cost
    ) resolved
  ) product_cost on true
`;
