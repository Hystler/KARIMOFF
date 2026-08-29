import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/product-types";

export function PopularMenu({ products }: { products: Product[] }) {
  return (
    <section id="menu" className="container-page pb-12 pt-4 sm:pb-16 sm:pt-6">
      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
