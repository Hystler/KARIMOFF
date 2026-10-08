import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/product-types";

export function PopularMenu({ products }: { products: Product[] }) {
  return (
    <section id="menu" className="container-page pb-12 pt-4 sm:pb-16 sm:pt-6">
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
