import mappingRules from "../../../../data/analytics/evotor-product-mappings.json";

export type ExplicitEvotorProductMapping = {
  productSlugs: string[];
  evotorNames: string[];
};

function normalizedLookupValue(value: string) {
  return value.normalize("NFKC").replaceAll("ё", "е").trim().toLowerCase();
}

function buildExplicitMappings(): ExplicitEvotorProductMapping[] {
  const claimedNames = new Map<string, string>();

  return mappingRules.map((rule) => {
    if (!rule.product_slugs.length || !rule.evotor_names.length) {
      throw new Error("Every explicit Evotor mapping must have product slugs and source names.");
    }

    for (const evotorName of rule.evotor_names) {
      const normalized = normalizedLookupValue(evotorName);
      const previousTarget = claimedNames.get(normalized);
      if (previousTarget) {
        throw new Error(`Duplicate explicit Evotor name mapping: ${evotorName} (${previousTarget}).`);
      }
      claimedNames.set(normalized, rule.product_slugs[0]);
    }

    return {
      productSlugs: [...rule.product_slugs],
      evotorNames: rule.evotor_names.map(normalizedLookupValue)
    };
  });
}

export const EXPLICIT_EVOTOR_PRODUCT_MAPPINGS = buildExplicitMappings();
