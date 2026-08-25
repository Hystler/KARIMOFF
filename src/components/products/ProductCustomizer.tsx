"use client";

import { Check, ShoppingBasket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getDefaultCartCustomization,
  isCartCustomizationValid,
  useCart
} from "@/components/cart/CartProvider";
import type { Product } from "@/lib/product-types";

export function ProductCustomizer({ product }: { product: Product }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(false);

  useEffect(() => {
    if (!isAdded) return undefined;
    const timeoutId = window.setTimeout(() => setIsAdded(false), 1100);
    return () => window.clearTimeout(timeoutId);
  }, [isAdded]);

  return (
    <button
      type="button"
      onClick={() => {
        const customization = getDefaultCartCustomization(product);
        if (!isCartCustomizationValid(product, customization)) {
          router.push(`/menu/${encodeURIComponent(product.slug)}`);
          return;
        }
        addItem(product, customization);
        setIsAdded(true);
      }}
      className={`product-cta overflow-hidden ${isAdded ? "product-cta-added" : ""}`}
      aria-live="polite"
    >
      {isAdded ? <Check aria-hidden size={18} strokeWidth={2.8} /> : <ShoppingBasket aria-hidden size={18} strokeWidth={2.4} />}
      <span>{isAdded ? "Добавлено" : "В корзину"}</span>
    </button>
  );
}
