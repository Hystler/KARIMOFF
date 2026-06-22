"use client";

import { useRef } from "react";
import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/product-types";

export function PopularMenu({ products }: { products: Product[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const showArrows = products.length > 4;

  function scrollMenu(direction: "left" | "right") {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    scroller.scrollBy({
      behavior: "smooth",
      left: direction === "left" ? -scroller.clientWidth * 0.9 : scroller.clientWidth * 0.9
    });
  }

  return (
    <section id="menu" className="container-page pb-12 pt-4 sm:pb-16">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-karimoff-orange">Меню KARIMOFF</p>
          <h2 className="mt-2 text-balance text-3xl font-black leading-tight text-karimoff-black sm:text-4xl">
            Всё меню в быстром доступе
          </h2>
        </div>
        {showArrows ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => scrollMenu("left")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-line bg-white text-xl font-black text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
              aria-label="Прокрутить меню влево"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => scrollMenu("right")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-orange bg-karimoff-orange text-xl font-black text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
              aria-label="Прокрутить меню вправо"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
      <div
        ref={scrollerRef}
        className="scrollbar-hide -mx-5 flex max-w-none snap-x snap-mandatory items-stretch gap-4 overflow-x-auto overflow-y-hidden px-5 pb-3 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
      >
        {products.map((product, index) => (
          <div key={product.id} className="min-w-0 shrink-0 basis-[82%] snap-start sm:basis-[46%] lg:basis-[23.5%]">
            <ProductCard product={product} index={index} />
          </div>
        ))}
      </div>
    </section>
  );
}
