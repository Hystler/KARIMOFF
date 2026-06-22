import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import { PageHero } from "@/components/PageHero";
import { ProductCard } from "@/components/ProductCard";
import { menuCategoryFilters, normalizeProductCategory, type NormalizedProductCategory } from "@/lib/product-categories";
import { getActiveProducts } from "@/lib/products";
import { getSiteSettings } from "@/lib/settings";

type MenuPageProps = {
  searchParams?: Promise<{
    category?: string;
  }>;
};

function getActiveCategory(value: string | undefined): "all" | NormalizedProductCategory {
  const allowed = new Set(menuCategoryFilters.map((filter) => filter.value));
  return allowed.has(value as "all" | NormalizedProductCategory) ? (value as "all" | NormalizedProductCategory) : "all";
}

export default async function MenuPage({ searchParams }: MenuPageProps) {
  const [products, settings] = await Promise.all([getActiveProducts(100), getSiteSettings()]);
  const params = searchParams ? await searchParams : {};
  const activeCategory = getActiveCategory(params.category);
  const visibleProducts =
    activeCategory === "all"
      ? products
      : products.filter((product) => normalizeProductCategory(product.category) === activeCategory);

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
        <div className="scrollbar-hide -mx-5 mb-7 flex gap-2 overflow-x-auto overflow-y-hidden px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {menuCategoryFilters.map((filter) => {
            const isActive = activeCategory === filter.value;
            const href = filter.value === "all" ? "/menu" : `/menu?category=${filter.value}`;

            return (
              <Link
                key={filter.value}
                href={href}
                className={`shrink-0 rounded-full border px-5 py-3 text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${
                  isActive
                    ? "border-karimoff-orange bg-karimoff-orange text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)]"
                    : "border-karimoff-line bg-white text-karimoff-black hover:border-karimoff-orange hover:text-karimoff-orange"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleProducts.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </div>
        {visibleProducts.length === 0 ? (
          <div className="rounded-xl border border-karimoff-line bg-white p-8 text-center text-sm font-semibold text-karimoff-muted">
            В этом разделе пока нет активных позиций.
          </div>
        ) : null}
      </section>
      <LeadForm />
    </main>
  );
}
