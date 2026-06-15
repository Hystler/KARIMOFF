import { LeadForm } from "@/components/LeadForm";
import { ProductCard } from "@/components/ProductCard";
import { getActiveProducts } from "@/lib/products";

export default async function MenuPage() {
  const products = await getActiveProducts(100);

  return (
    <main className="pt-28">
      <section className="container-page pb-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold text-karimoff-orange">
            Меню KARIMOFF
          </p>
          <h1 className="text-balance text-4xl font-black leading-[0.95] text-karimoff-black sm:text-6xl">
            Фирменные позиции без ресторанной паузы
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-karimoff-muted sm:text-lg">
            Бургеры, шаурма, хот-доги, боксы, горячие закуски и напитки.
            Добавляйте позиции в корзину и оставляйте заявку.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
