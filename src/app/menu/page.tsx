import { LeadForm } from "@/components/LeadForm";
import { PageHero } from "@/components/PageHero";
import { ProductCard } from "@/components/ProductCard";
import { getActiveProducts } from "@/lib/products";
import { getSiteSettings } from "@/lib/settings";

export default async function MenuPage() {
  const [products, settings] = await Promise.all([getActiveProducts(100), getSiteSettings()]);

  return (
    <main>
      <PageHero
        eyebrow="Меню KARIMOFF"
        title="Фирменные позиции без ресторанной паузы"
        subtitle="Бургеры, шаурма, хот-доги, боксы, горячие закуски и напитки. Добавляйте позиции в корзину и оформляйте заказ после входа."
        imageUrl={settings.menu_hero_image_url}
        objectPosition="center"
      />
      <section className="container-page py-12 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
