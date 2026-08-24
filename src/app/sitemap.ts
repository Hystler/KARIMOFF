import type { MetadataRoute } from "next";
import { getActiveProducts } from "@/lib/products";

const PUBLIC_ORIGIN = "https://karimoff.site";
const staticRoutes = [
  "",
  "/menu",
  "/about",
  "/business",
  "/careers",
  "/franchise",
  "/legal/offer",
  "/legal/privacy",
  "/legal/personal-data-consent",
  "/legal/cookies",
  "/legal/delivery",
  "/legal/loyalty",
  "/legal/requisites"
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getActiveProducts(1_000);
  return [
    ...staticRoutes.map((path) => ({
      url: `${PUBLIC_ORIGIN}${path}`,
      changeFrequency: path === "/menu" ? "daily" as const : "monthly" as const,
      priority: path === "" ? 1 : path === "/menu" ? 0.9 : 0.6
    })),
    ...products.map((product) => ({
      url: `${PUBLIC_ORIGIN}/menu/${encodeURIComponent(product.slug)}`,
      lastModified: product.updated_at ? new Date(product.updated_at) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8
    }))
  ];
}
