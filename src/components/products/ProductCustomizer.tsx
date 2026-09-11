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
import { getPortionGroup } from "@/lib/product-serving";

export function ProductCustomizer({ product }: { product: Product }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(false);
  const needsConfiguration = Boolean(getPortionGroup(product)) ||
    Boolean(product.modifier_options?.some((option) => option.is_removable || option.is_extra_available)) ||
    Boolean(product.modifier_groups?.length);

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
        if (needsConfiguration || !isCartCustomizationValid(product, customization)) {
          router.push(`/menu/${encodeURIComponent(product.slug)}`);
          return;
        }
        addItem(product, customization);
        setIsAdded(true);
      }}
      className={`public-button-primary product-cta ${isAdded ? "product-cta-added" : ""}`}
      aria-live="polite"
    >
      {isAdded ? <Check aria-hidden size={18} strokeWidth={2.8} /> : <ShoppingBasket aria-hidden size={18} strokeWidth={2.4} />}
      <span>{isAdded ? "Добавлено" : getPortionGroup(product) ? "Выбрать порцию" : needsConfiguration ? "Настроить" : "В корзину"}</span>
    </button>
  );
}
