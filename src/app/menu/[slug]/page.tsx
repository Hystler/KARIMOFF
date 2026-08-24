import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, Info, Utensils } from "lucide-react";
import { ProductDetailPurchase } from "@/components/products/ProductDetailPurchase";
import type { Product } from "@/lib/product-types";
import { getProductNutrition } from "@/lib/product-nutrition";
import { getActiveProductBySlug, getPublicProductComposition } from "@/lib/products";

const PUBLIC_ORIGIN = "https://karimoff.site";
const getProduct = cache(getActiveProductBySlug);

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function productDescription(product: Product) {
  return product.description || `${product.name} в меню KARIMOFF.`;
}

function productPlaceholder(category: string) {
  if (category === "Бургеры") return "/assets/products/placeholder-burger.svg";
  if (category === "Шаурма") return "/assets/products/placeholder-shaurma.svg";
  if (category === "Хот-Доги") return "/assets/products/placeholder-hotdog.svg";
  if (category === "Боксы") return "/assets/products/placeholder-box.svg";
  if (category === "Напитки") return "/assets/products/placeholder-drink.svg";
  return "/assets/products/placeholder-snack.svg";
}

function ProductImage({ product }: { product: Product }) {
  const source = product.image_url || productPlaceholder(product.category);

  if (source.startsWith("/")) {
    return (
      <Image
        src={source}
        alt={product.name}
        fill
        priority
        sizes="(min-width: 1024px) 48vw, 100vw"
        className="object-contain"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={source} alt={product.name} className="h-full w-full object-contain" fetchPriority="high" />
  );
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    return {
      title: "Товар не найден | KARIMOFF",
      robots: { index: false, follow: false }
    };
  }

  const description = productDescription(product).slice(0, 180);
  const canonical = `/menu/${encodeURIComponent(product.slug)}`;

  return {
    title: `${product.name} | Меню KARIMOFF`,
    description,
    alternates: { canonical },
    openGraph: {
      title: product.name,
      description,
      type: "website",
      url: canonical,
      ...(product.image_url ? { images: [{ url: product.image_url, alt: product.name }] } : {})
    }
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  const composition = await getPublicProductComposition(product.id);
  const nutrition = getProductNutrition(product);
  const canonicalUrl = `${PUBLIC_ORIGIN}/menu/${encodeURIComponent(product.slug)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: productDescription(product),
    ...(product.image_url ? { image: [product.image_url] } : {}),
    category: product.category,
    sku: product.slug,
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: "RUB",
      price: product.price.toFixed(2),
      availability: "https://schema.org/InStock"
    }
  };

  return (
    <main className="min-h-screen bg-karimoff-cream pb-16 pt-24 sm:pb-24 sm:pt-28">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <div className="container-page">
        <Link
          href="/menu"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-karimoff-muted transition hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange"
        >
          <ArrowLeft size={18} aria-hidden />
          Вернуться в меню
        </Link>

        <section className="mt-4 overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-[0_24px_70px_rgba(18,18,20,0.09)] lg:grid lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)]">
          <div className="relative min-h-[340px] border-b border-karimoff-line bg-[#F8F2EA] p-6 sm:min-h-[520px] sm:p-10 lg:min-h-full lg:border-b-0 lg:border-r">
            <ProductImage product={product} />
          </div>
          <div className="p-5 sm:p-8 lg:p-10">
            <p className="text-sm font-black uppercase text-karimoff-orange">{product.category}</p>
            <h1 className="mt-3 text-3xl font-black leading-tight text-karimoff-black sm:text-4xl lg:text-5xl">
              {product.name}
            </h1>
            <p className="admin-number mt-5 text-3xl font-black text-karimoff-orange">
              {formatPrice(product.price)} ₽
            </p>
            {product.weight ? <p className="mt-2 text-sm font-bold text-karimoff-muted">Выход: {product.weight}</p> : null}
            <p className="mt-6 text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              {product.description || "Описание блюда уточняется."}
            </p>
            <ProductDetailPurchase product={product} />
          </div>
        </section>

        <section className="mt-10 grid gap-8 border-t border-karimoff-line pt-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="flex items-center gap-2 text-sm font-black uppercase text-karimoff-orange">
              <Utensils size={18} aria-hidden />
              Состав
            </p>
            <h2 className="mt-3 text-2xl font-black text-karimoff-black sm:text-3xl">Что входит в блюдо</h2>
            {composition.length ? (
              <p className="mt-4 text-base leading-8 text-karimoff-muted">
                {composition.map((item) => item.name).join(", ")}.
              </p>
            ) : (
              <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-karimoff-muted">
                <Info size={17} aria-hidden />
                Состав уточняется.
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-black uppercase text-karimoff-orange">КБЖУ</p>
            <h2 className="mt-3 text-2xl font-black text-karimoff-black sm:text-3xl">Пищевая ценность</h2>
            <p className="mt-2 text-sm text-karimoff-muted">На одну порцию{product.weight ? ` · ${product.weight}` : ""}</p>
            {nutrition.available ? (
              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-karimoff-line bg-karimoff-line sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {nutrition.items.map((item) => (
                  <div key={item.key} className="min-w-0 bg-white p-4">
                    <dt className="text-xs font-bold text-karimoff-muted">{item.label}</dt>
                    <dd className="admin-number mt-2 text-lg font-black text-karimoff-black">
                      {item.value === null ? "Уточняется" : `${item.value} ${item.unit}`}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-karimoff-line bg-white px-4 py-5 text-sm font-semibold text-karimoff-muted">
                Данные уточняются.
              </p>
            )}
          </div>
        </section>

        {product.allergens?.length ? (
          <section className="mt-10 border-t border-karimoff-line pt-8">
            <p className="text-sm font-black uppercase text-karimoff-orange">Аллергены</p>
            <p className="mt-3 max-w-3xl text-base leading-7 text-karimoff-muted">
              {product.allergens.join(", ")}.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
