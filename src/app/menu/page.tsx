import { LeadForm } from "@/components/LeadForm";
import { MenuCategoryRail } from "@/components/MenuCategoryRail";
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
  const availableCategoryFilters = menuCategoryFilters.filter(
    (filter) =>
      filter.value === "all" ||
      products.some((product) => normalizeProductCategory(product.category) === filter.value)
  );
  const visibleProducts =
    activeCategory === "all"
      ? products
      : products.filter((product) => normalizeProductCategory(product.category) === activeCategory);

  return (
    <main>
      <PageHero
        eyebrow="Меню KARIMOFF"
        title="Попробуй реально вкусный фастфуд"
        subtitle="Регистрируйтесь, делайте заказ и получайте бонусы от Karimoff"
        imageUrl={settings.menu_hero_image_url}
        objectPosition="center"
      />
      <section className="container-page py-8 sm:py-12">
        <MenuCategoryRail filters={availableCategoryFilters} activeCategory={activeCategory} />
        <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
        {visibleProducts.length === 0 ? (
          <div className="rounded-lg border border-karimoff-line bg-white p-8 text-center text-sm font-semibold text-karimoff-muted">
            В этом разделе пока нет активных позиций.
          </div>
        ) : null}
      </section>
      <LeadForm />
    </main>
  );
}
