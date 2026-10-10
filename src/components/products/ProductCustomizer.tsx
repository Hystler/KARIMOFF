"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getDefaultCartCustomization,
  isCartCustomizationValid,
  useCart
} from "@/components/cart/CartProvider";
import type { Product } from "@/lib/product-types";

export function ProductCustomizer({ product, onCustomize }: { product: Product; onCustomize: () => void }) {
  const { addItem } = useCart();
  const [isAdded, setIsAdded] = useState(false);

  useEffect(() => {
    if (!isAdded) return undefined;
    const timeoutId = window.setTimeout(() => setIsAdded(false), 1100);
    return () => window.clearTimeout(timeoutId);
  }, [isAdded]);

  const accessibleLabel = isAdded
    ? `${product.name} добавлен в корзину`
    : `Добавить ${product.name} в корзину`;

  return (
    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
    <button
      type="button"
      onClick={() => {
        const customization = getDefaultCartCustomization(product);
        if (!isCartCustomizationValid(product, customization)) {
          onCustomize();
          return;
        }
        addItem(product, customization);
        setIsAdded(true);
      }}
      className={`public-button-primary product-cta min-w-0 flex-1 gap-1 ${isAdded ? "product-cta-added" : ""}`}
      aria-live="polite"
      aria-label={accessibleLabel}
    >
      {isAdded ? <Check aria-hidden size={16} className="shrink-0" strokeWidth={2.8} /> : null}
      <span className="min-w-0 truncate">
        {isAdded ? "Добавлено" : "В корзину"}
      </span>
    </button>
    <button type="button" onClick={onCustomize} className="public-icon-button shrink-0" aria-label={`Настроить ингредиенты: ${product.name}`} aria-haspopup="dialog">
      <SlidersHorizontal size={18} aria-hidden />
    </button>
    </div>
  );
}
