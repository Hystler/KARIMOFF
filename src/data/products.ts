import importedProducts from "../../data/import/juikaifui-products.json";
import type { Product } from "@/lib/product-types";

type ImportedProduct = {
  source_id?: string;
  name: string;
  slug: string;
  category: string;
  description?: string | null;
  unit?: string | null;
  price: number;
  image_url_local?: string | null;
  is_active: boolean;
  sort_order: number;
};

function getProductPlaceholder(category: string) {
  if (category === "Бургеры") {
    return "/assets/products/placeholder-burger.svg";
  }

  if (category === "Шаурма") {
    return "/assets/products/placeholder-shaurma.svg";
  }

  if (category === "Хот-Доги") {
    return "/assets/products/placeholder-hotdog.svg";
  }

  if (category === "Боксы") {
    return "/assets/products/placeholder-box.svg";
  }

  if (category === "Напитки") {
    return "/assets/products/placeholder-drink.svg";
  }

  return "/assets/products/placeholder-snack.svg";
}

export const demoProducts: Product[] = (importedProducts as ImportedProduct[]).map((product) => ({
  id: product.source_id ?? product.slug,
  name: product.name,
  slug: product.slug,
  category: product.category,
  description: product.description || null,
  price: product.price,
  image_url: product.image_url_local || getProductPlaceholder(product.category),
  is_active: product.is_active,
  sort_order: product.sort_order,
  weight: product.unit || null,
  tags: null
}));
