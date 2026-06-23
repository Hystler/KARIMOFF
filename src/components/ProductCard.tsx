"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useCart } from "@/components/cart/CartProvider";
import type { Product } from "@/lib/product-types";

type ProductCardProps = {
  product: Product;
  index?: number;
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
      <img src={src} alt={product.name} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]" />
    );
  }

  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={product.name}
        fill
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        className="object-contain transition duration-500 group-hover:scale-[1.03]"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={product.name} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]" />
  );
}

export function ProductCard({ product, index = 0 }: ProductCardProps) {
  const { addItem } = useCart();

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.02, 0.16) }}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-karimoff-line bg-white shadow-card transition hover:-translate-y-1 hover:border-karimoff-orange/55 hover:shadow-[0_20px_55px_rgba(18,18,20,0.12)]"
    >
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-[#F8F2EA] p-2 sm:p-4">
        <ProductImage product={product} />
      </div>
      <div className="flex flex-1 flex-col p-2.5 sm:p-3.5">
        <h3 className="line-clamp-2 min-h-[38px] text-[15px] font-black leading-tight text-karimoff-black sm:min-h-[42px] sm:text-[18px]">{product.name}</h3>
        <p className="mt-1.5 text-lg font-black leading-none text-karimoff-orange sm:text-xl">{formatPrice(product.price)} ₽</p>
        {product.description ? (
          <p className="mt-2 line-clamp-2 min-h-[38px] text-[12px] leading-[19px] text-karimoff-muted sm:mt-2.5 sm:min-h-[44px] sm:text-[13px] sm:leading-[22px]">{product.description}</p>
        ) : (
          <p className="mt-2 line-clamp-2 min-h-[38px] text-[12px] leading-[19px] text-karimoff-muted sm:mt-2.5 sm:min-h-[44px] sm:text-[13px] sm:leading-[22px]">Фирменная позиция KARIMOFF.</p>
        )}
        <button
          type="button"
          onClick={() => addItem(product)}
          className="mt-auto w-full rounded-full border border-karimoff-orange bg-karimoff-orange px-3 py-2.5 text-xs font-bold text-white shadow-[0_12px_28px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 sm:px-4 sm:text-sm"
        >
          В корзину
        </button>
      </div>
    </motion.article>
  );
}
