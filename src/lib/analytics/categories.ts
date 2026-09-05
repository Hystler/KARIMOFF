import categoryRules from "../../../data/analytics/evotor-category-rules.json";

type AnalyticsCategoryRule = {
  category: string;
  contains_any: string[];
};

function normalize(value: string) {
  return value.normalize("NFKC").replaceAll("ё", "е").trim().toLowerCase();
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function likeLiteral(value: string) {
  return sqlLiteral(`%${value.replace(/[\\%_]/g, "\\$&")}%`);
}

function validatedRules(): AnalyticsCategoryRule[] {
  const seen = new Set<string>();
  return categoryRules.map((rule) => {
    const category = rule.category.trim();
    const patterns = rule.contains_any.map(normalize).filter(Boolean);
    if (!category || !patterns.length) throw new Error("Analytics category rules must not be empty.");
    for (const pattern of patterns) {
      if (seen.has(pattern)) throw new Error(`Duplicate analytics category pattern: ${pattern}`);
      seen.add(pattern);
    }
    return { category, contains_any: patterns };
  });
}

export const ANALYTICS_CATEGORY_RULES = validatedRules();

export function analyticsCategorySql(alias = "i") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid analytics SQL alias.");
  const normalizedName = `lower(replace(trim(${alias}.product_name), 'ё', 'е'))`;
  const clauses = ANALYTICS_CATEGORY_RULES.map((rule) => {
    const matches = rule.contains_any
      .map((pattern) => `${normalizedName} like ${likeLiteral(pattern)} escape '\\'`)
      .join(" or ");
    return `when ${matches} then ${sqlLiteral(rule.category)}`;
  }).join("\n");
  return `coalesce(case ${clauses} end, ${alias}.category)`;
}
