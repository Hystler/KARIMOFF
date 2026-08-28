"use client";

import Image from "next/image";
import Link from "next/link";
import { ProductCustomizer } from "@/components/products/ProductCustomizer";
import type { Product } from "@/lib/product-types";

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
  const src = product.image_url || getProductPlaceholder(product.category);

  if (src.endsWith(".svg")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={product.name}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]"
      />
    );
  }

  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={product.name}
        fill
        sizes="(min-width: 1280px) 220px, (min-width: 1024px) calc((100vw - 7rem) / 4), (min-width: 640px) calc((100vw - 4rem) / 3), calc((100vw - 3.25rem) / 2)"
        loading="lazy"
        fetchPriority="low"
        className="object-contain transition duration-500 group-hover:scale-[1.03]"
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
      className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]"
    />
  );
}

export function ProductCard({ product }: ProductCardProps) {
  const href = `/menu/${encodeURIComponent(product.slug)}`;

  return (
    <article
      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-karimoff-orange/55 hover:shadow-[0_18px_44px_rgba(18,18,20,0.12)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "430px" }}
    >
      <Link
        href={href}
        className="relative block aspect-[4/3] shrink-0 overflow-hidden border-b border-karimoff-line/70 bg-[#F8F2EA] p-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-karimoff-orange sm:p-4"
        aria-label={`Открыть ${product.name}`}
      >
        <ProductImage product={product} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        <Link
          href={href}
          className="flex min-w-0 flex-1 flex-col rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-karimoff-orange"
        >
          <h3 className="line-clamp-2 min-h-10 overflow-wrap-anywhere text-base font-black leading-5 text-karimoff-black transition group-hover:text-karimoff-orange sm:min-h-11 sm:text-lg sm:leading-[22px]">
            {product.name}
          </h3>
          <p className="admin-number mt-2 text-lg font-black leading-none text-karimoff-orange sm:text-xl">
            {formatPrice(product.price)} ₽
          </p>
          <p className="mt-2.5 line-clamp-3 min-h-[60px] overflow-wrap-anywhere text-[13px] leading-5 text-karimoff-muted sm:min-h-[66px] sm:text-sm sm:leading-[22px]">
            {product.description || "Описание блюда скоро появится."}
          </p>
          <p className="mt-2 min-h-[18px] text-xs font-bold leading-[18px] text-karimoff-muted">
            {product.weight || "\u00a0"}
          </p>
        </Link>
        <ProductCustomizer product={product} />
      </div>
    </article>
  );
}
