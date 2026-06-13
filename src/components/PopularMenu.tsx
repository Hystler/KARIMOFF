"use client";

import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/product-types";

export function PopularMenu({ products }: { products: Product[] }) {
  return (
    <section id="menu" className="container-page pb-14 pt-0 sm:pb-20">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product, index) => (
          <ProductCard key={product.id} product={product} index={index} />
        ))}
      </div>
    </section>
  );
}
