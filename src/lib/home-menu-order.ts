import type { Product } from "@/lib/product-types";

// Editorial order requested by the owner; exact active slugs verified read-only in production.
// Sales ranking is reported separately and is not used to pretend this is a bestseller ranking.
export const homeFeaturedProductSlugs = [
  "shaurma-kurinaya",
  "tayson",
  "chicken-roll",
  "shaurma-v-lepeshke-govyadina"
] as const;

export function orderHomeMenu(products: Product[]): Product[] {
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const featured = homeFeaturedProductSlugs.flatMap((slug) => {
    const product = bySlug.get(slug);
    return product ? [product] : [];
  });
  const featuredIds = new Set(featured.map((product) => product.id));
  return [...featured, ...products.filter((product) => !featuredIds.has(product.id))];
}
