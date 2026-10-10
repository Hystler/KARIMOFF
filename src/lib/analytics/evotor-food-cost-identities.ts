import manifest from "../../../data/analytics/evotor-food-cost-identities.json";

export type EvotorFoodCostIdentity = {
  sku: string; names: string[]; kind: string; product_slug?: string;
  ingredient_id?: string; original_ingredient_id?: string; quantity?: number; unit?: string;
};

const explicitRules: EvotorFoodCostIdentity[] = [
  ...manifest.rules,
  ...manifest.replacement_groups.flatMap(({ variants, ...group }) =>
    variants.map((variant) => ({ ...group, ...variant, kind: "replacement" })))
];

// Names check a known receipt snapshot; they are never a fuzzy lookup key.
export function foodCostIdentityRows(rules: EvotorFoodCostIdentity[] = explicitRules) {
  const seen = new Set<string>();
  return rules.map((rule) => {
    if (seen.has(rule.sku)) throw new Error("Duplicate Evotor food-cost SKU");
    seen.add(rule.sku);
    if (!rule.sku || !rule.names.length || !["recipe", "portion", "component", "replacement"].includes(rule.kind)
      || (rule.kind !== "component" && !rule.product_slug)
      || (rule.kind !== "recipe" && (!rule.ingredient_id || !rule.unit
        || !Number.isFinite(rule.quantity) || !(Number(rule.quantity) > 0)))
      || (rule.kind === "replacement" && !rule.original_ingredient_id)) {
      throw new Error("Incomplete Evotor food-cost identity");
    }
    return { ...rule, store_id: manifest.store_id, valid_from: manifest.valid_from,
      names: [...new Set(rule.names.map((name) => name.trim().toLocaleLowerCase("ru-RU")))] };
  });
}

export const EVOTOR_FOOD_COST_IDENTITIES_CTE = `
  evotor_food_cost_identities as (
    select * from jsonb_to_recordset('${JSON.stringify(foodCostIdentityRows()).replaceAll("'", "''")}'::jsonb)
      as identity(sku text, names text[], kind text, product_slug text,
        ingredient_id uuid, original_ingredient_id uuid, quantity numeric, unit text, store_id text, valid_from timestamptz)
  )
`;
