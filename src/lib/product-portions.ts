import imported from "../../data/import/juikaifui-products.json";
import copy from "../../data/catalog/public-product-copy.json";
import { normalizeServing, PORTION_GROUP_NAME } from "./product-serving";

// Original menu export includes actual portion prices, unlike the imported free-text weight.
export function getProductAliases(slug: string) {
  return Object.values(copy).find(item => item.aliases.includes(slug))?.aliases ?? [slug];
}

export function getImportedPortions(slug: string) {
  const aliases = getProductAliases(slug);
  const source = imported.find(item => aliases.includes(item.slug));
  if (!source || source.category !== "Горячие закуски" || source.modifiers.length < 2) return [];
  return source.modifiers.map(item => ({ label: normalizeServing(item.unit), quantity: Number.parseFloat(item.unit), price: item.price }))
    .filter((item): item is { label: string; quantity: number; price: number } => Boolean(item.label) && Number.isFinite(item.quantity))
    .sort((a, b) => a.quantity - b.quantity);
}

export { PORTION_GROUP_NAME };
