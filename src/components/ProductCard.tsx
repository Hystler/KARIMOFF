"use client";

import Image from "next/image";
import Link from "next/link";
import { ProductCustomizer } from "@/components/products/ProductCustomizer";
import { getProductImageUrl } from "@/lib/product-image-url";
import type { Product } from "@/lib/product-types";
import { getPortionGroup, getServingLabel } from "@/lib/product-serving";

type ProductCardProps = {
  product: Product;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

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

function ProductImage({ product }: { product: Product }) {
  const rawSrc = product.image_url || getProductPlaceholder(product.category);
  const src = getProductImageUrl(rawSrc) ?? rawSrc;

  if (rawSrc.endsWith(".svg")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={product.name}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
    );
  }

  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={product.name}
        fill
        sizes="(min-width: 1280px) 288px, (min-width: 1024px) calc((100vw - 7rem) / 3), (min-width: 768px) calc((100vw - 5.5rem) / 3), (min-width: 640px) calc((100vw - 4.75rem) / 2), (min-width: 520px) calc((100vw - 3.25rem) / 2), calc((100vw - 2rem) / 2)"
        loading="lazy"
        fetchPriority="low"
        className="object-cover transition duration-500 group-hover:scale-[1.03]"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={product.name}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
    />
  );
}

export function ProductCard({ product }: ProductCardProps) {
  const href = `/menu/${encodeURIComponent(product.slug)}`;
  const servingLabel = getServingLabel(product);

  return (
    <article
      className="product-card group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-card transition-colors duration-200 hover:border-karimoff-orange/55"
    >
      <Link
        href={href}
        className="product-photo relative block aspect-[16/10] shrink-0 overflow-hidden border-b border-karimoff-line/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-karimoff-orange sm:aspect-[4/3]"
        aria-label={`Открыть ${product.name}`}
      >
        <ProductImage product={product} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-2 sm:p-3 lg:p-4">
        <Link
          href={href}
          className="flex min-w-0 flex-1 flex-col rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-karimoff-orange"
        >
          <h3 className="line-clamp-2 min-h-9 overflow-wrap-anywhere text-sm font-bold leading-[18px] text-karimoff-black transition group-hover:text-karimoff-orange-contrast sm:min-h-[48px] sm:text-lg sm:leading-6">
            {product.name}
          </h3>
          <p className="admin-number mt-1 font-heading text-base font-black leading-5 text-karimoff-orange-contrast sm:mt-2 sm:text-xl sm:leading-none">
            {getPortionGroup(product) ? "от " : ""}{formatPrice(product.price)} ₽
          </p>
          <p className="mt-2 hidden overflow-wrap-anywhere text-sm leading-[1.5] text-karimoff-muted md:line-clamp-2 md:block">
            {product.description || "Описание блюда скоро появится."}
          </p>
        </Link>
        {servingLabel ? (
          <p className="mt-2 hidden text-xs font-medium leading-4 text-karimoff-muted sm:line-clamp-1 sm:block">{servingLabel}</p>
        ) : null}
        <div className="mt-2 sm:mt-3">
          <ProductCustomizer product={product} />
        </div>
      </div>
    </article>
  );
}
