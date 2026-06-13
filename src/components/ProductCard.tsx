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

function ProductImage({ product }: { product: Product }) {
  const src = product.image_url || "/assets/burger-obama.png";

  if (src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt={product.name}
        fill
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover transition duration-500 group-hover:scale-105"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
  );
}

export function ProductCard({ product, index = 0 }: ProductCardProps) {
  const { addItem } = useCart();

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay: index * 0.05 }}
      className="group overflow-hidden rounded-xl border border-karimoff-line bg-white shadow-card transition hover:-translate-y-1 hover:border-karimoff-orange/55 hover:shadow-[0_20px_55px_rgba(18,18,20,0.12)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-karimoff-soft">
        <ProductImage product={product} />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/72 to-transparent" />
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-2xl font-black text-karimoff-black">{product.name}</h3>
          <span className="rounded-full bg-karimoff-orange/10 px-3 py-1 text-sm font-black text-karimoff-orange">
            {formatPrice(product.price)} ₽
          </span>
        </div>
        {product.description ? (
          <p className="mt-3 min-h-20 text-sm leading-6 text-karimoff-muted">{product.description}</p>
        ) : (
          <p className="mt-3 min-h-20 text-sm leading-6 text-karimoff-muted">Фирменная позиция KARIMOFF.</p>
        )}
        <button
          type="button"
          onClick={() => addItem(product)}
          className="mt-5 w-full rounded-full border border-karimoff-orange bg-karimoff-orange px-4 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-karimoff-black"
        >
          В заказ
        </button>
      </div>
    </motion.article>
  );
}
