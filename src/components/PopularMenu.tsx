"use client";

import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/product-types";

export function PopularMenu({ products }: { products: Product[] }) {
  return (
    <section id="menu" className="container-page pb-12 pt-5 sm:pb-16 sm:pt-7">
      <div className="mb-5 max-w-2xl">
        <p className="text-sm font-semibold text-karimoff-orange">Меню KARIMOFF</p>
        <h2 className="mt-2 text-balance text-3xl font-black leading-tight text-karimoff-black sm:text-4xl">
          Всё меню в быстром доступе
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product, index) => (
          <ProductCard key={product.id} product={product} index={index} />
        ))}
      </div>
    </section>
  );
}
